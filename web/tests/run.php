<?php
// Uruchom: php web/tests/run.php  (stawia lokalny serwer z atrapami sklepów)
declare(strict_types=1);

require __DIR__ . '/../lib/Price.php';

$fails = 0;
function check(string $name, bool $ok, $detail = null): void
{
    global $fails;
    echo ($ok ? "ok   " : "FAIL ") . $name . ($ok ? '' : ' -> ' . json_encode($detail)) . "\n";
    $fails += $ok ? 0 : 1;
}

// --- Price::parse ---
foreach ([['€1,234.50', 1234.5], ['1 234,50 zł', 1234.5], ['12.99', 12.99], ['€49', 49.0], ['1.234', 1234.0], ['', null], ['free', null]] as [$in, $exp]) {
    check("parse '$in'", Price::parse($in) === $exp, Price::parse($in));
}
$ld = '<script type="application/ld+json">{"@type":"Product","gtin13":"123","offers":{"price":"9,99","priceCurrency":"EUR"}}</script>';
check('json-ld', Price::jsonLdOffer($ld) === ['gtin' => '123', 'price' => 9.99, 'currency' => 'EUR'], Price::jsonLdOffer($ld));

// --- serwer ---
$port = random_int(20000, 40000);
$root = realpath(__DIR__ . '/..');
$proc = proc_open(['php', '-S', "127.0.0.1:$port", '-t', $root], [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, $root,
    ['PHP_CLI_SERVER_WORKERS' => '4', 'DEALHUNTER_ALLOW_LOCAL' => '1', 'PATH' => getenv('PATH')]);
register_shutdown_function(fn() => proc_terminate($proc));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) {
    usleep(100000);
}
$base = "http://127.0.0.1:$port";

function api(string $base, array $body): array
{
    $ch = curl_init("$base/api.php?action=check");
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_POSTFIELDS => json_encode($body),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_TIMEOUT => 30]);
    $out = json_decode((string) curl_exec($ch), true);
    return is_array($out) ? $out : ['raw' => 'invalid'];
}

$dest = ['country' => 'IE', 'postcode' => 'D02 X285'];

$r = api($base, ['url' => "$base/mock/shopify.php/products/demo-headphones", 'codes' => ['BAD', 'SAVE10'], 'destination' => $dest]);
check('shopify: adapter', ($r['adapter'] ?? '') === 'Shopify', $r);
check('shopify: ceny', ($r['item_price'] ?? 0) == 49.9 && ($r['shipping'] ?? 0) == 4.99 && ($r['total_no_code'] ?? 0) == 54.89, $r);
check('shopify: kod SAVE10', ($r['code_used'] ?? '') === 'SAVE10' && ($r['total_final'] ?? 0) == 49.9, $r);
check('shopify: zły kod niepotwierdzony', str_starts_with($r['codes_tried']['BAD'] ?? '', 'niepotwierdzony'), $r);
check('shopify: verified', ($r['status'] ?? '') === 'verified', $r);

$r = api($base, ['url' => "$base/mock/woo.php/product/demo-headphones", 'codes' => ['NOPE', 'WELCOME5'], 'destination' => $dest]);
check('woo: adapter', ($r['adapter'] ?? '') === 'WooCommerce', $r);
check('woo: najtańsza dostawa i suma', ($r['shipping'] ?? 0) == 3.5 && ($r['total_no_code'] ?? 0) == 55.5, $r);
check('woo: kod WELCOME5', ($r['code_used'] ?? '') === 'WELCOME5' && ($r['total_final'] ?? 0) == 50.5, $r);
check('woo: zły kod odrzucony', str_starts_with($r['codes_tried']['NOPE'] ?? '', 'nie działa'), $r);

$r = api($base, ['url' => 'http://127.0.0.1:1/x', 'codes' => [], 'destination' => $dest]);
check('błąd połączenia -> error', ($r['status'] ?? '') === 'error', $r);

// SSRF: serwer bez ALLOW_LOCAL musi blokować localhost
putenv('DEALHUNTER_ALLOW_LOCAL');
require __DIR__ . '/../lib/Http.php';
foreach (['http://127.0.0.1/', 'http://169.254.169.254/latest', 'http://10.0.0.5/', 'file:///etc/passwd'] as $u) {
    try {
        Http::resolvePublic($u);
        check("ssrf blokuje $u", false);
    } catch (RuntimeException $e) {
        check("ssrf blokuje $u", true);
    }
}

echo $fails ? "\n$fails FAILED\n" : "\nALL OK\n";
exit($fails ? 1 : 0);
