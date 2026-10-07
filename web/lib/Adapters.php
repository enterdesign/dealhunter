<?php
declare(strict_types=1);

/** Wynik jest tablicą: item_price, shipping, total_no_code, total_final, currency, code_used, codes_tried, verified, note. */
interface Adapter
{
    public function name(): string;

    /** Czy sklep jest obsługiwany tą platformą (lekki test, bez zmian w koszyku). */
    public function probe(Http $http): bool;

    public function check(Http $http, array $codes, array $dest): array;
}

final class ShopifyAdapter implements Adapter
{
    private int $variant = 0;
    private float $listPrice = 0.0;

    private function __construct(private string $base, private string $handle, private string $query) {}

    public static function fromUrl(string $url): ?self
    {
        $u = parse_url($url);
        if (!isset($u['host']) || !preg_match('#^(.*?)/products/([^/?\#.]+)#', $u['path'] ?? '', $m)) {
            return null;
        }
        $origin = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
        return new self($origin . $m[1], $m[2], $u['query'] ?? '');
    }

    public function name(): string
    {
        return 'Shopify';
    }

    public function probe(Http $http): bool
    {
        $r = $http->get("{$this->base}/products/{$this->handle}.js");
        $d = $r['status'] === 200 ? $http->json($r) : null;
        if (!$d || empty($d['variants'])) {
            return false;
        }
        parse_str($this->query, $q);
        $want = isset($q['variant']) ? (int) $q['variant'] : 0;
        foreach ($d['variants'] as $v) {
            if (($want && (int) $v['id'] === $want) || (!$want && !empty($v['available']))) {
                $this->variant = (int) $v['id'];
                $this->listPrice = $v['price'] / 100;
                return true;
            }
        }
        $this->variant = (int) $d['variants'][0]['id'];
        $this->listPrice = $d['variants'][0]['price'] / 100;
        return true;
    }

    public function check(Http $http, array $codes, array $dest): array
    {
        $res = ['verified' => false, 'codes_tried' => [], 'note' => ''];
        $add = $http->postJson("{$this->base}/cart/add.js", ['items' => [['id' => $this->variant, 'quantity' => 1]]], ['Accept: application/json']);
        if ($add['status'] !== 200) {
            $res['note'] = 'Nie udało się dodać do koszyka (wyprzedane?).';
            return $res;
        }
        $cart = $http->json($http->get("{$this->base}/cart.js"));
        if (!$cart || !isset($cart['total_price'])) {
            $res['note'] = 'Nie udało się odczytać koszyka.';
            return $res;
        }
        $items = $cart['total_price'] / 100;
        $res['currency'] = $cart['currency'] ?? '';
        $res['item_price'] = $this->listPrice ?: $items;

        $ship = $this->shipping($http, $dest);
        $res['shipping'] = $ship;
        if ($ship === null) {
            $res['note'] = 'Koszt dostawy nieznany (sklep nie udostępnia wyliczenia przed checkoutem).';
        }
        $res['total_no_code'] = $res['total_final'] = round($items + ($ship ?? 0), 2);
        $res['verified'] = true;

        $best = $res['total_final'];
        foreach ($codes as $code) {
            $http->get("{$this->base}/discount/" . rawurlencode($code));
            $c2 = $http->json($http->get("{$this->base}/cart.js"));
            $new = isset($c2['total_price']) ? $c2['total_price'] / 100 : null;
            if ($new !== null && $new < $items - 0.005) {
                $total = round($new + ($ship ?? 0), 2);
                $res['codes_tried'][$code] = sprintf('działa: %.2f', $total);
                if ($total < $best) {
                    $best = $total;
                    $res['code_used'] = $code;
                }
            } else {
                $res['codes_tried'][$code] = 'niepotwierdzony w koszyku (Shopify często potwierdza kod dopiero w checkoutcie)';
            }
        }
        $res['total_final'] = $best;
        return $res;
    }

    private function shipping(Http $http, array $dest): ?float
    {
        if (($dest['postcode'] ?? '') === '' && ($dest['country'] ?? '') === '') {
            return null;
        }
        $qs = http_build_query(['shipping_address' => [
            'zip' => $dest['postcode'] ?? '', 'country' => $dest['country'] ?? '', 'province' => '',
        ]]);
        $r = $http->get("{$this->base}/cart/shipping_rates.json?$qs");
        $d = $r['status'] === 200 ? $http->json($r) : null;
        $prices = array_map(fn($x) => (float) $x['price'], $d['shipping_rates'] ?? []);
        return $prices ? min($prices) : null;
    }
}

final class WooAdapter implements Adapter
{
    private int $productId = 0;
    private float $listPrice = 0.0;
    private string $nonce = '';

    private function __construct(private string $base, private string $slug) {}

    public static function fromUrl(string $url): ?self
    {
        $u = parse_url($url);
        if (!isset($u['host']) || !preg_match('#^(.*?)/(?:product|produkt|produit|producto)/([^/?\#]+)#', $u['path'] ?? '', $m)) {
            return null;
        }
        $origin = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
        return new self($origin . $m[1], $m[2]);
    }

    public function name(): string
    {
        return 'WooCommerce';
    }

    private function api(string $path): string
    {
        return "{$this->base}/wp-json/wc/store/v1/$path";
    }

    public function probe(Http $http): bool
    {
        $r = $http->get($this->api('products?slug=' . rawurlencode($this->slug)));
        $d = $r['status'] === 200 ? $http->json($r) : null;
        if (!$d || empty($d[0]['id'])) {
            return false;
        }
        $this->productId = (int) $d[0]['id'];
        $minor = (int) ($d[0]['prices']['currency_minor_unit'] ?? 2);
        $this->listPrice = (float) ($d[0]['prices']['price'] ?? 0) / (10 ** $minor);
        return true;
    }

    private function money(array $totals, string $key): float
    {
        return (float) ($totals[$key] ?? 0) / (10 ** (int) ($totals['currency_minor_unit'] ?? 2));
    }

    private function mutate(Http $http, string $path, array $data): array
    {
        return $http->postJson($this->api($path), $data, ['Nonce: ' . $this->nonce, 'Accept: application/json']);
    }

    public function check(Http $http, array $codes, array $dest): array
    {
        $res = ['verified' => false, 'codes_tried' => [], 'note' => ''];
        $first = $http->get($this->api('cart'));
        $this->nonce = $first['headers']['nonce'] ?? $first['headers']['x-wc-store-api-nonce'] ?? '';
        $add = $this->mutate($http, 'cart/add-item', ['id' => $this->productId, 'quantity' => 1]);
        if ($add['status'] >= 300) {
            $res['note'] = 'Nie udało się dodać do koszyka (' . ($http->json($add)['message'] ?? 'HTTP ' . $add['status']) . ').';
            return $res;
        }
        if (($dest['postcode'] ?? '') !== '' || ($dest['country'] ?? '') !== '') {
            $addr = ['country' => $dest['country'] ?? '', 'postcode' => $dest['postcode'] ?? '', 'city' => $dest['city'] ?? ''];
            $this->mutate($http, 'cart/update-customer', ['shipping_address' => $addr, 'billing_address' => $addr]);
        }
        $cart = $this->selectCheapestShipping($http, $http->json($http->get($this->api('cart'))));
        if (!$cart || !isset($cart['totals']['total_price'])) {
            $res['note'] = 'Nie udało się odczytać koszyka.';
            return $res;
        }
        $t = $cart['totals'];
        $res['currency'] = $t['currency_code'] ?? '';
        $res['item_price'] = $this->listPrice ?: $this->money($t, 'total_items');
        $res['shipping'] = $this->money($t, 'total_shipping');
        $base = $this->money($t, 'total_price');
        $res['total_no_code'] = $res['total_final'] = round($base, 2);
        $res['verified'] = true;
        if (empty($cart['shipping_rates'][0]['shipping_rates'])) {
            $res['shipping'] = null;
            $res['note'] = 'Koszt dostawy nieznany (brak stawek dla podanego adresu).';
        }

        $best = $base;
        foreach ($codes as $code) {
            $r = $this->mutate($http, 'cart/apply-coupon', ['code' => $code]);
            if ($r['status'] >= 300) {
                $res['codes_tried'][$code] = 'nie działa: ' . strip_tags((string) ($http->json($r)['message'] ?? 'odrzucony'));
                continue;
            }
            $c2 = $this->selectCheapestShipping($http, $http->json($r));
            $new = $this->money($c2['totals'] ?? [], 'total_price');
            if ($new > 0 && $new < $base - 0.005) {
                $res['codes_tried'][$code] = sprintf('działa: %.2f', $new);
                if ($new < $best) {
                    $best = $new;
                    $res['code_used'] = $code;
                    $res['shipping'] = $res['shipping'] === null ? null : $this->money($c2['totals'], 'total_shipping');
                }
            } else {
                $res['codes_tried'][$code] = 'zaakceptowany, ale bez wpływu na cenę';
            }
            $this->mutate($http, 'cart/remove-coupon', ['code' => $code]);
        }
        $res['total_final'] = round($best, 2);
        return $res;
    }

    private function selectCheapestShipping(Http $http, ?array $cart): ?array
    {
        $pkg = $cart['shipping_rates'][0] ?? null;
        if (!$pkg || empty($pkg['shipping_rates'])) {
            return $cart;
        }
        $rates = $pkg['shipping_rates'];
        usort($rates, fn($a, $b) => (int) $a['price'] <=> (int) $b['price']);
        $cheapest = $rates[0];
        if (!empty($cheapest['selected'])) {
            return $cart;
        }
        $r = $this->mutate($http, 'cart/select-shipping-rate', ['package_id' => $pkg['package_id'] ?? 0, 'rate_id' => $cheapest['rate_id']]);
        return $r['status'] < 300 ? ($http->json($r) ?? $cart) : $cart;
    }
}

/** Sklep bez znanej platformy: tylko cena z JSON-LD, bez koszyka. */
final class JsonLdAdapter implements Adapter
{
    public function __construct(private string $url) {}

    public function name(): string
    {
        return 'JSON-LD (bez koszyka)';
    }

    public function probe(Http $http): bool
    {
        return true;
    }

    public function check(Http $http, array $codes, array $dest): array
    {
        $r = $http->get($this->url, ['Accept: text/html']);
        $offer = $r['status'] === 200 ? Price::jsonLdOffer($r['body']) : [];
        $res = ['verified' => false, 'codes_tried' => [], 'note' => 'Nieznana platforma sklepu – cena ze strony produktu, bez kodu i dostawy.'];
        if (isset($offer['price'])) {
            $res['item_price'] = $res['total_no_code'] = $res['total_final'] = $offer['price'];
            $res['currency'] = $offer['currency'] ?? '';
        } else {
            $res['note'] = $r['status'] === 200 ? 'Nieznana platforma i brak ceny w danych strony.' : 'Strona zwróciła HTTP ' . $r['status'] . '.';
        }
        return $res;
    }
}

final class Checker
{
    /** Wybiera adapter, uruchamia sprawdzenie i zwraca wynik dla frontendu. */
    public static function run(string $url, array $codes, array $dest): array
    {
        $http = new Http();
        $candidates = array_filter([ShopifyAdapter::fromUrl($url), WooAdapter::fromUrl($url)]);
        $adapter = null;
        foreach ($candidates as $a) {
            try {
                if ($a->probe($http)) {
                    $adapter = $a;
                    break;
                }
            } catch (RuntimeException $e) {
                continue;
            }
        }
        $adapter ??= new JsonLdAdapter($url);
        $out = ['adapter' => $adapter->name(), 'status' => 'error'];
        try {
            $r = $adapter->check($http, $codes, $dest);
        } catch (RuntimeException $e) {
            $out['note'] = $e->getMessage();
            return $out;
        }
        $out = array_merge($out, $r);
        unset($out['verified']);
        $out['status'] = ($out['total_final'] ?? null) === null ? 'error' : (($r['verified'] ?? false) ? 'verified' : 'unverified');
        return $out;
    }
}
