<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function normalizeEmail(string $value): string
{
    return strtolower(trim($value));
}

function normalizePhone(string $value): string
{
    $value = preg_replace('/\s+/', '', $value);
    return preg_replace('/[^0-9+]/', '', $value);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['error' => 'Method not allowed.'], 405);
}

try {
    $body = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    $identifier = trim((string) ($body['identifier'] ?? ''));
    $password = (string) ($body['password'] ?? '');

    if ($identifier === '' || $password === '') {
        respond(['error' => 'Email or phone number and password are required.'], 422);
    }

    $normalizedIdentifier = filter_var($identifier, FILTER_VALIDATE_EMAIL)
        ? normalizeEmail($identifier)
        : normalizePhone($identifier);

    $statement = database()->prepare(
        'SELECT id, name, email, phone, password_hash, is_verified
         FROM users WHERE email = ? OR phone = ? LIMIT 1'
    );
    $statement->execute([$normalizedIdentifier, $normalizedIdentifier]);
    $user = $statement->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        respond(['error' => 'Invalid email/phone or password.'], 401);
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['user_name'] = $user['name'];

    respond([
        'success' => true,
        'message' => 'Welcome back.',
        'user' => [
            'id' => $user['id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'phone' => $user['phone']
        ]
    ]);
} catch (JsonException $exception) {
    respond(['error' => 'Invalid JSON payload.'], 422);
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    respond(['error' => 'Unable to login right now.'], 500);
}
