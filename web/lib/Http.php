<?php
declare(strict_types=1);

/** Lekki klient HTTP (cURL) z cookie jar, limitem rozmiaru i ochroną SSRF. */
final class Http
{
    private string $jar;
    private const MAX_BODY = 3_000_000;
    private const MAX_REDIRECTS = 5;

    public function __construct()
    {
        $this->jar = tempnam(sys_get_temp_dir(), 'dhjar');
    }

    public function __destruct()
    {
        @unlink($this->jar);
    }

    /** @return array{status:int, headers:array<string,string>, body:string, url:string} */
    public function get(string $url, array $headers = []): array
    {
        return $this->request('GET', $url, $headers);
    }

    public function postJson(string $url, array $data, array $headers = []): array
    {
        $headers[] = 'Content-Type: application/json';
        return $this->request('POST', $url, $headers, json_encode($data, JSON_UNESCAPED_UNICODE));
    }

    public function json(array $res): ?array
    {
        $d = json_decode($res['body'], true);
        return is_array($d) ? $d : null;
    }

    public function request(string $method, string $url, array $headers = [], ?string $body = null): array
    {
        for ($hop = 0; $hop <= self::MAX_REDIRECTS; $hop++) {
            [$host, $port, $ip] = self::resolvePublic($url);
            $buf = '';
            $resp = [];
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_CUSTOMREQUEST => $method,
                CURLOPT_FOLLOWLOCATION => false,
                CURLOPT_TIMEOUT => 15,
                CURLOPT_CONNECTTIMEOUT => 6,
                CURLOPT_COOKIEFILE => $this->jar,
                CURLOPT_COOKIEJAR => $this->jar,
                CURLOPT_ENCODING => '',
                CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
                CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; DealHunter/1.0)',
                CURLOPT_HTTPHEADER => array_merge(['Accept: application/json, text/html;q=0.8, */*;q=0.5'], $headers),
                CURLOPT_RESOLVE => $ip ? ["$host:$port:$ip"] : [],
                CURLOPT_HEADERFUNCTION => function ($c, string $line) use (&$resp) {
                    if (strpos($line, ':') !== false) {
                        [$k, $v] = explode(':', $line, 2);
                        $resp[strtolower(trim($k))] = trim($v);
                    }
                    return strlen($line);
                },
                CURLOPT_WRITEFUNCTION => function ($c, string $chunk) use (&$buf) {
                    $buf .= $chunk;
                    return strlen($buf) > self::MAX_BODY ? 0 : strlen($chunk);
                },
            ]);
            if ($body !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
            }
            curl_exec($ch);
            $err = curl_error($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            curl_close($ch);
            if ($status === 0) {
                throw new RuntimeException('Błąd połączenia: ' . ($err ?: 'brak odpowiedzi'));
            }
            if (in_array($status, [301, 302, 303, 307, 308], true) && !empty($resp['location'])) {
                $url = self::absolute($url, $resp['location']);
                if (in_array($status, [301, 302, 303], true)) {
                    $method = 'GET';
                    $body = null;
                    $headers = array_values(array_filter($headers, fn($h) => stripos($h, 'content-type:') !== 0));
                }
                continue;
            }
            return ['status' => $status, 'headers' => $resp, 'body' => $buf, 'url' => $url];
        }
        throw new RuntimeException('Zbyt wiele przekierowań.');
    }

    /** @return array{0:string,1:int,2:?string} host, port, zweryfikowany IP */
    public static function resolvePublic(string $url): array
    {
        $u = parse_url($url);
        $scheme = strtolower($u['scheme'] ?? '');
        $host = $u['host'] ?? '';
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
            throw new RuntimeException('Dozwolone są tylko linki http(s).');
        }
        $port = $u['port'] ?? ($scheme === 'https' ? 443 : 80);
        if (getenv('DEALHUNTER_ALLOW_LOCAL') === '1') {
            return [$host, $port, null];
        }
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
        if (!$ips) {
            throw new RuntimeException('Nie można rozpoznać domeny.');
        }
        foreach ($ips as $ip) {
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                throw new RuntimeException('Adres prywatny jest zablokowany.');
            }
        }
        return [$host, $port, $ips[0]]; // przypięcie IP chroni przed DNS rebinding
    }

    public static function absolute(string $base, string $loc): string
    {
        if (preg_match('#^https?://#i', $loc)) {
            return $loc;
        }
        $b = parse_url($base);
        $root = $b['scheme'] . '://' . $b['host'] . (isset($b['port']) ? ':' . $b['port'] : '');
        if (str_starts_with($loc, '/')) {
            return $root . $loc;
        }
        $dir = rtrim(dirname($b['path'] ?? '/'), '/');
        return $root . $dir . '/' . $loc;
    }
}
