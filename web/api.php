<?php
declare(strict_types=1);

require __DIR__ . '/lib/Http.php';
require __DIR__ . '/lib/Price.php';
require __DIR__ . '/lib/Adapters.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

const RATE_LIMIT = 60;      // sprawdzeń na IP...
const RATE_WINDOW = 600;    // ...w oknie 10 minut
const MAX_CODES = 8;

function fail(int $code, string $msg): never
{
    http_response_code($code);
    echo json_encode(['error' => $msg], JSON_UNESCAPED_UNICODE);
    exit;
}

function rateLimited(): bool
{
    $file = sys_get_temp_dir() . '/dealhunter_rl_' . md5($_SERVER['REMOTE_ADDR'] ?? 'x');
    $fh = fopen($file, 'c+');
    flock($fh, LOCK_EX);
    $times = array_filter(json_decode(stream_get_contents($fh) ?: '[]', true) ?: [], fn($t) => $t > time() - RATE_WINDOW);
    $limited = count($times) >= RATE_LIMIT;
    if (!$limited) {
        $times[] = time();
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode(array_values($times)));
    flock($fh, LOCK_UN);
    fclose($fh);
    return $limited;
}

if (($_GET['action'] ?? '') !== 'check' || $_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(404, 'Nieznana akcja.');
}
$in = json_decode(file_get_contents('php://input') ?: '', true);
$url = is_array($in) ? (string) ($in['url'] ?? '') : '';
if ($url === '' || strlen($url) > 2000) {
    fail(400, 'Brak poprawnego linku do produktu.');
}
if (rateLimited()) {
    fail(429, 'Za dużo zapytań – spróbuj za kilka minut.');
}
$codes = array_slice(array_values(array_unique(array_filter(
    array_map(fn($c) => trim((string) $c), (array) ($in['codes'] ?? [])),
    fn($c) => $c !== '' && strlen($c) <= 64
))), 0, MAX_CODES);
$d = (array) ($in['destination'] ?? []);
$dest = [
    'country' => substr((string) ($d['country'] ?? ''), 0, 2),
    'postcode' => substr((string) ($d['postcode'] ?? ''), 0, 16),
    'city' => substr((string) ($d['city'] ?? ''), 0, 64),
];

set_time_limit(40);
try {
    echo json_encode(Checker::run($url, $codes, $dest), JSON_UNESCAPED_UNICODE | JSON_PARTIAL_OUTPUT_ON_ERROR);
} catch (Throwable $e) {
    echo json_encode(['status' => 'error', 'adapter' => '', 'note' => $e instanceof RuntimeException ? $e->getMessage() : 'Błąd wewnętrzny.'], JSON_UNESCAPED_UNICODE);
}
