<?php
// Atrapa sklepu w stylu Shopify (do testów i demo). URL: /mock/shopify.php/products/demo-headphones
declare(strict_types=1);
session_start();
header('Content-Type: application/json');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = substr($path, strpos($path, 'shopify.php') + strlen('shopify.php'));
$cart = &$_SESSION['cart'];
$price = 4990;

function cartJson(int $price): array
{
    $c = $_SESSION['cart'] ?? null;
    $code = $_SESSION['discount'] ?? '';
    $total = $c ? $price : 0;
    if ($c && $code === 'SAVE10') {
        $total = (int) round($price * 0.9);
    }
    return ['total_price' => $total, 'currency' => 'EUR', 'item_count' => $c ? 1 : 0];
}

if (preg_match('#^/products/([^/.]+)\.js$#', $path)) {
    echo json_encode(['id' => 1, 'title' => 'Słuchawki Demo', 'variants' => [['id' => 1001, 'price' => $price, 'available' => true]]]);
} elseif ($path === '/cart/add.js') {
    $in = json_decode(file_get_contents('php://input'), true);
    $_SESSION['cart'] = $in['items'][0] ?? null;
    echo json_encode($_SESSION['cart'] ?? []);
} elseif ($path === '/cart.js') {
    echo json_encode(cartJson($price));
} elseif ($path === '/cart/shipping_rates.json') {
    $z = $_GET['shipping_address']['zip'] ?? '';
    echo json_encode(['shipping_rates' => $z === '' ? [] : [['name' => 'Standard', 'price' => '4.99']]]);
} elseif (preg_match('#^/discount/(.+)$#', $path, $m)) {
    $_SESSION['discount'] = strtoupper(rawurldecode($m[1]));
    http_response_code(302);
    header('Location: /mock/shopify.php/products/demo-headphones.js');
} else {
    http_response_code(404);
    echo '{}';
}
