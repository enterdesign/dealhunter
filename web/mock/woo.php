<?php
// Atrapa Store API WooCommerce (testy/demo). URL: /mock/woo.php/product/demo-headphones
declare(strict_types=1);
session_start();
header('Content-Type: application/json');
const NONCE = 'abc123';
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = substr($path, strpos($path, 'woo.php') + strlen('woo.php'));
$method = $_SERVER['REQUEST_METHOD'];
$in = json_decode(file_get_contents('php://input'), true) ?: [];
$P = '/wp-json/wc/store/v1';

function cart(): array
{
    $s = $_SESSION;
    $items = !empty($s['has']) ? 5200 : 0;
    $disc = !empty($s['coupon']) && $s['coupon'] === 'WELCOME5' ? 500 : 0;
    $zip = $s['zip'] ?? '';
    $rates = [];
    if ($items && $zip !== '') {
        $rates = [[
            'package_id' => 0,
            'shipping_rates' => [
                ['rate_id' => 'express', 'name' => 'Express', 'price' => '900', 'selected' => ($s['rate'] ?? '') === 'express'],
                ['rate_id' => 'flat', 'name' => 'Flat', 'price' => '350', 'selected' => ($s['rate'] ?? 'flat') === 'flat'],
            ],
        ]];
    }
    $ship = 0;
    foreach ($rates[0]['shipping_rates'] ?? [] as $r) {
        if ($r['selected']) {
            $ship = (int) $r['price'];
        }
    }
    return ['totals' => [
        'currency_code' => 'EUR', 'currency_minor_unit' => 2,
        'total_items' => (string) $items, 'total_discount' => (string) $disc,
        'total_shipping' => (string) $ship, 'total_price' => (string) ($items - $disc + $ship),
    ], 'shipping_rates' => $rates];
}

$mutating = $method === 'POST';
if ($mutating && ($_SERVER['HTTP_NONCE'] ?? '') !== NONCE) {
    http_response_code(403);
    echo json_encode(['code' => 'woocommerce_rest_missing_nonce', 'message' => 'Missing nonce']);
    exit;
}

if ($path === "$P/products") {
    echo json_encode([['id' => 77, 'slug' => $_GET['slug'] ?? '', 'prices' => ['price' => '5200', 'currency_minor_unit' => 2]]]);
} elseif ($path === "$P/cart" && $method === 'GET') {
    header('Nonce: ' . NONCE);
    echo json_encode(cart());
} elseif ($path === "$P/cart/add-item") {
    $_SESSION['has'] = true;
    echo json_encode(cart());
} elseif ($path === "$P/cart/update-customer") {
    $_SESSION['zip'] = $in['shipping_address']['postcode'] ?? '';
    echo json_encode(cart());
} elseif ($path === "$P/cart/select-shipping-rate") {
    $_SESSION['rate'] = $in['rate_id'] ?? 'flat';
    echo json_encode(cart());
} elseif ($path === "$P/cart/apply-coupon") {
    $c = strtoupper($in['code'] ?? '');
    if ($c !== 'WELCOME5' && $c !== 'NOOP') {
        http_response_code(400);
        echo json_encode(['code' => 'woocommerce_rest_cart_coupon_error', 'message' => 'Coupon "' . ($in['code'] ?? '') . '" does not exist!']);
    } else {
        $_SESSION['coupon'] = $c;
        echo json_encode(cart());
    }
} elseif ($path === "$P/cart/remove-coupon") {
    unset($_SESSION['coupon']);
    echo json_encode(cart());
} else {
    http_response_code(404);
    echo '{}';
}
