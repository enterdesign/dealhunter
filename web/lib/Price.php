<?php
declare(strict_types=1);

final class Price
{
    /** '€1,234.50' / '1 234,50 zł' / '12.99' -> float, null gdy brak liczby. */
    public static function parse(string $text): ?float
    {
        if (!preg_match('/\d[\d\s\x{00a0}.,]*/u', $text, $m)) {
            return null;
        }
        $s = rtrim(preg_replace('/[\s\x{00a0}]/u', '', $m[0]), '.,');
        if ($s === '') {
            return null;
        }
        $dot = strrpos($s, '.');
        $comma = strrpos($s, ',');
        $dec = null;
        if ($dot !== false && $comma !== false) {
            $dec = $dot > $comma ? '.' : ',';
        } elseif ($dot !== false || $comma !== false) {
            $sep = $dot !== false ? '.' : ',';
            $after = strlen($s) - strrpos($s, $sep) - 1;
            $dec = ($after >= 1 && $after <= 2 && substr_count($s, $sep) === 1) ? $sep : null;
        }
        if ($dec !== null) {
            $pos = strrpos($s, $dec);
            $s = preg_replace('/[.,]/', '', substr($s, 0, $pos)) . '.' . substr($s, $pos + 1);
        } else {
            $s = preg_replace('/[.,]/', '', $s);
        }
        return is_numeric($s) ? (float) $s : null;
    }

    /** Z HTML wyciąga {price, currency, gtin} z bloków JSON-LD. */
    public static function jsonLdOffer(string $html): array
    {
        $out = [];
        if (!preg_match_all('#<script[^>]+application/ld\+json[^>]*>(.*?)</script>#is', $html, $mm)) {
            return $out;
        }
        foreach ($mm[1] as $raw) {
            $data = json_decode(html_entity_decode(trim($raw)), true);
            if (is_array($data)) {
                self::walk($data, $out);
            }
        }
        return $out;
    }

    private static function walk(array $node, array &$out): void
    {
        foreach (['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14'] as $k) {
            if (isset($node[$k]) && is_scalar($node[$k]) && !isset($out['gtin'])) {
                $out['gtin'] = (string) $node[$k];
            }
        }
        foreach (['price', 'lowPrice'] as $k) {
            if (isset($node[$k]) && is_scalar($node[$k]) && !isset($out['price'])) {
                $p = self::parse((string) $node[$k]);
                if ($p !== null) {
                    $out['price'] = $p;
                    $out['currency'] = is_string($node['priceCurrency'] ?? null) ? $node['priceCurrency'] : '';
                }
            }
        }
        foreach ($node as $v) {
            if (is_array($v)) {
                self::walk($v, $out);
            }
        }
    }
}
