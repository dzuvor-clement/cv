<?php
declare(strict_types=1);

session_start();
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type');
header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/vendor/autoload.php';

use PHPMailer\PHPMailer\PHPMailer;

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function validId(string $id): bool
{
    return (bool) preg_match('/^[a-f0-9-]{36}$/i', $id);
}

function generateUuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0F) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3F) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function generateOtp(): string
{
    return str_pad((string) random_int(100000, 999999), 6, '0', STR_PAD_LEFT);
}

function normalizeEmail(string $value): string
{
    return strtolower(trim($value));
}

function normalizePhone(string $value): string
{
    $value = preg_replace('/\s+/', '', $value);
    $value = preg_replace('/[^0-9+]/', '', $value);
    return $value;
}

function channelForIdentifier(string $type): string
{
    return $type === 'phone' ? 'phone' : 'email';
}

function sendOtpEmail(string $recipient, string $otp, string $purpose): void
{
    if (SMTP_USERNAME === '' || SMTP_PASSWORD === '' || SMTP_FROM_EMAIL === '') {
        throw new RuntimeException('SMTP is not configured.');
    }

    $mailer = new PHPMailer(true);
    $mailer->isSMTP();
    $mailer->Host = SMTP_HOST;
    $mailer->Port = SMTP_PORT;
    $mailer->SMTPAuth = true;
    $mailer->Username = SMTP_USERNAME;
    $mailer->Password = SMTP_PASSWORD;
    $mailer->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
    $mailer->setFrom(SMTP_FROM_EMAIL, SMTP_FROM_NAME);
    $mailer->addAddress($recipient);
    $mailer->isHTML(false);
    $mailer->Subject = 'Your Northstar CV verification code';
    $mailer->Body = "Your Northstar CV {$purpose} code is: {$otp}\n\nThis code expires in 10 minutes. If you did not request it, you can ignore this email.";
    $mailer->send();
}

try {
    $pdo = database();
    $id = (string) ($_GET['id'] ?? '');

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
        $action = (string) ($_GET['action'] ?? ($body['action'] ?? ''));

        if ($action === 'register' || $action === 'send-otp') {
            $name = trim((string) ($body['name'] ?? ''));
            $identifierType = strtolower(trim((string) ($body['identifierType'] ?? 'email')));
            $identifier = trim((string) ($body['identifier'] ?? ''));
            $password = (string) ($body['password'] ?? '');
            $confirmPassword = (string) ($body['confirmPassword'] ?? '');

            if ($name === '' || $password === '' || strlen($password) < 6 || $password !== $confirmPassword) {
                respond(['error' => 'Full name and a 6+ character password are required.'], 422);
            }

            if ($identifierType !== 'email' && $identifierType !== 'phone') {
                respond(['error' => 'Use an email or phone number as your contact.'], 422);
            }

            $normalizedIdentifier = $identifierType === 'phone' ? normalizePhone($identifier) : normalizeEmail($identifier);

            if ($identifierType === 'email' && !filter_var($normalizedIdentifier, FILTER_VALIDATE_EMAIL)) {
                respond(['error' => 'Please provide a valid email address.'], 422);
            }

            if ($identifierType === 'phone' && !preg_match('/^\+?[0-9]{7,15}$/', $normalizedIdentifier)) {
                respond(['error' => 'Please provide a valid phone number.'], 422);
            }

            $existing = $pdo->prepare(
                $identifierType === 'email'
                    ? 'SELECT id FROM users WHERE email = ? LIMIT 1'
                    : 'SELECT id FROM users WHERE phone = ? LIMIT 1'
            );
            $existing->execute([$normalizedIdentifier]);
            if ($existing->fetch()) {
                respond(['error' => 'An account with this contact already exists.'], 409);
            }

            $userId = generateUuid();
            $email = $identifierType === 'email' ? $normalizedIdentifier : null;
            $phone = $identifierType === 'phone' ? $normalizedIdentifier : null;

            $insertUser = $pdo->prepare(
                'INSERT INTO users (id, name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, ?, 1)'
            );
            $insertUser->execute([$userId, $name, $email, $phone, password_hash($password, PASSWORD_DEFAULT)]);

            $statement = $pdo->prepare(
                'INSERT INTO cvs (id, user_id, title, cv_data) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), cv_data = VALUES(cv_data)'
            );
            $statement->execute([
                $userId,
                $userId,
                'My CV',
                json_encode([
                    'basics' => ['name' => ''],
                    'summary' => '',
                    'skills' => '',
                    'experience' => [],
                    'education' => [],
                    'toggles' => ['summary' => false, 'certifications' => false, 'awards' => false, 'publications' => false, 'memberships' => false],
                    'certifications' => [],
                    'awards' => [],
                    'publications' => [],
                    'memberships' => []
                ], JSON_THROW_ON_ERROR)
            ]);

            session_regenerate_id(true);
            $_SESSION['user_id'] = $userId;
            $_SESSION['user_name'] = $name;

            respond([
                'success' => true,
                'message' => 'Account created successfully.',
                'user' => ['id' => $userId, 'name' => $name, 'email' => $email, 'phone' => $phone]
            ]);
        }

        if ($action === 'send-reset-otp') {
            $identifierType = strtolower(trim((string) ($body['identifierType'] ?? 'email')));
            $identifier = trim((string) ($body['identifier'] ?? ''));

            if ($identifierType !== 'email' && $identifierType !== 'phone') {
                respond(['error' => 'Verification can be sent by email or phone number.'], 422);
            }

            $normalizedIdentifier = $identifierType === 'phone' ? normalizePhone($identifier) : normalizeEmail($identifier);
            $validIdentifier = $identifierType === 'email'
                ? filter_var($normalizedIdentifier, FILTER_VALIDATE_EMAIL)
                : preg_match('/^\+?[0-9]{7,15}$/', $normalizedIdentifier);

            if (!$validIdentifier) {
                respond(['error' => 'Please provide a valid email address or phone number.'], 422);
            }

            $channel = channelForIdentifier($identifierType);
            if ($channel !== 'email') {
                respond(['error' => 'SMS password reset is not configured. Please use an email address.'], 422);
            }
            $statement = $pdo->prepare(
                $identifierType === 'email'
                    ? 'SELECT id FROM users WHERE email = ? LIMIT 1'
                    : 'SELECT id FROM users WHERE phone = ? LIMIT 1'
            );
            $statement->execute([$normalizedIdentifier]);
            $user = $statement->fetch();
            $response = ['success' => true, 'message' => 'If an account matches, a reset code has been sent.'];

            if ($user) {
                $otp = generateOtp();
                sendOtpEmail($normalizedIdentifier, $otp, 'password reset');
                $statement = $pdo->prepare(
                    'INSERT INTO password_resets (id, user_id, identifier, channel, otp_hash, expires_at)
                     VALUES (?, ?, ?, ?, ?, ?)'
                );
                $statement->execute([
                    generateUuid(),
                    $user['id'],
                    $normalizedIdentifier,
                    $channel,
                    hash('sha256', $otp),
                    date('Y-m-d H:i:s', time() + 600)
                ]);
            }

            respond($response);
        }

        if ($action === 'reset-password') {
            $identifierType = strtolower(trim((string) ($body['identifierType'] ?? 'email')));
            $identifier = trim((string) ($body['identifier'] ?? ''));
            $otp = trim((string) ($body['otp'] ?? ''));
            $password = (string) ($body['password'] ?? '');
            $confirmPassword = (string) ($body['confirmPassword'] ?? '');

            if (($identifierType !== 'email' && $identifierType !== 'phone') || $otp === '' || strlen($password) < 6 || $password !== $confirmPassword) {
                respond(['error' => 'A valid contact, reset code, and password with at least 6 characters are required.'], 422);
            }

            $normalizedIdentifier = $identifierType === 'phone' ? normalizePhone($identifier) : normalizeEmail($identifier);
            $channel = channelForIdentifier($identifierType);
            $statement = $pdo->prepare(
                'SELECT id, user_id, otp_hash, expires_at FROM password_resets
                 WHERE identifier = ? AND channel = ? AND used_at IS NULL
                 ORDER BY created_at DESC LIMIT 1'
            );
            $statement->execute([$normalizedIdentifier, $channel]);
            $reset = $statement->fetch();

            if (!$reset || new DateTimeImmutable($reset['expires_at']) < new DateTimeImmutable() || !hash_equals($reset['otp_hash'], hash('sha256', $otp))) {
                respond(['error' => 'That reset code is invalid or expired. Please request a new one.'], 401);
            }

            $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
                ->execute([password_hash($password, PASSWORD_DEFAULT), $reset['user_id']]);
            $pdo->prepare('UPDATE password_resets SET used_at = NOW() WHERE id = ?')->execute([$reset['id']]);

            $statement = $pdo->prepare('SELECT id, name, email, phone FROM users WHERE id = ? LIMIT 1');
            $statement->execute([$reset['user_id']]);
            $user = $statement->fetch();
            session_regenerate_id(true);
            $_SESSION['user_id'] = $user['id'];
            $_SESSION['user_name'] = $user['name'];

            respond(['success' => true, 'message' => 'Password updated successfully.', 'user' => $user]);
        }

        if ($action === 'verify-otp') {
            $identifierType = strtolower(trim((string) ($body['identifierType'] ?? 'email')));
            $identifier = trim((string) ($body['identifier'] ?? ''));
            $otp = trim((string) ($body['otp'] ?? ''));

            if ($identifierType !== 'email' && $identifierType !== 'phone') {
                respond(['error' => 'Verification type is invalid.'], 422);
            }

            $normalizedIdentifier = $identifierType === 'phone' ? normalizePhone($identifier) : normalizeEmail($identifier);
            $channel = channelForIdentifier($identifierType);

            $statement = $pdo->prepare(
                'SELECT id, name, password_hash, otp_hash, expires_at
                 FROM otp_verifications
                 WHERE identifier = ? AND channel = ? AND used_at IS NULL
                 ORDER BY created_at DESC LIMIT 1'
            );
            $statement->execute([$normalizedIdentifier, $channel]);
            $pending = $statement->fetch();

            if (!$pending) {
                respond(['error' => 'No pending verification found. Please request a new OTP.'], 400);
            }

            if (new DateTimeImmutable($pending['expires_at']) < new DateTimeImmutable()) {
                respond(['error' => 'This OTP has expired. Please request a new one.'], 410);
            }

            if (hash('sha256', $otp) !== $pending['otp_hash']) {
                respond(['error' => 'The verification code is incorrect.'], 401);
            }

            $userId = generateUuid();
            $name = (string) $pending['name'];
            $passwordHash = (string) $pending['password_hash'];
            $email = $channel === 'email' ? $normalizedIdentifier : null;
            $phone = $channel === 'phone' ? $normalizedIdentifier : null;

            $insertUser = $pdo->prepare(
                'INSERT INTO users (id, name, email, phone, password_hash, is_verified) VALUES (?, ?, ?, ?, ?, 1)'
            );
            $insertUser->execute([$userId, $name, $email, $phone, $passwordHash]);

            $statement = $pdo->prepare(
                'INSERT INTO cvs (id, user_id, title, cv_data) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), cv_data = VALUES(cv_data)'
            );
            $statement->execute([
                $userId,
                $userId,
                'My CV',
                json_encode([
                    'basics' => ['name' => ''],
                    'summary' => '',
                    'skills' => '',
                    'experience' => [],
                    'education' => [],
                    'toggles' => ['summary' => false, 'certifications' => false, 'awards' => false, 'publications' => false, 'memberships' => false],
                    'certifications' => [],
                    'awards' => [],
                    'publications' => [],
                    'memberships' => []
                ], JSON_THROW_ON_ERROR)
            ]);

            $pdo->prepare('UPDATE otp_verifications SET used_at = NOW() WHERE id = ?')->execute([$pending['id']]);

            session_regenerate_id(true);
            $_SESSION['user_id'] = $userId;
            $_SESSION['user_name'] = $name;

            respond([
                'success' => true,
                'message' => 'Your account has been verified successfully.',
                'user' => ['id' => $userId, 'name' => $name, 'email' => $email, 'phone' => $phone]
            ]);
        }

        if ($action === 'login') {
            $identifier = trim((string) ($body['identifier'] ?? ''));
            $password = (string) ($body['password'] ?? '');
            $normalizedIdentifier = filter_var($identifier, FILTER_VALIDATE_EMAIL) ? normalizeEmail($identifier) : normalizePhone($identifier);

            $statement = $pdo->prepare(
                'SELECT id, name, email, phone, password_hash, is_verified FROM users WHERE email = ? OR phone = ? LIMIT 1'
            );
            $statement->execute([$normalizedIdentifier, $normalizedIdentifier]);
            $user = $statement->fetch();

            if (!$user || !password_verify($password, $user['password_hash'])) {
                respond(['error' => 'Invalid email/phone or password.'], 401);
            }

            respond([
                'success' => true,
                'user' => ['id' => $user['id'], 'name' => $user['name'], 'email' => $user['email'], 'phone' => $user['phone']]
            ]);
        }
    }

    $sessionUserId = (string) ($_SESSION['user_id'] ?? '');
    if (!validId($sessionUserId)) {
        respond(['error' => 'Please login to access your CV.'], 401);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        $id = $sessionUserId;

        if (!validId($id)) {
            respond(['error' => 'A valid user id is required.'], 400);
        }

        $statement = $pdo->prepare('SELECT id, title, cv_data, updated_at FROM cvs WHERE user_id = ? LIMIT 1');
        $statement->execute([$id]);
        $cv = $statement->fetch();

        if (!$cv) {
            respond(['cv' => null]);
        }

        $cv['cv_data'] = json_decode($cv['cv_data'], true, 512, JSON_THROW_ON_ERROR);
        respond(['cv' => $cv]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
        $cvData = $body['cv_data'] ?? null;
        $title = trim((string) ($body['title'] ?? 'My CV'));
        $userId = $sessionUserId;

        if (!validId($userId)) {
            respond(['error' => 'A valid user id is required.'], 400);
        }

        if (!is_array($cvData)) {
            respond(['error' => 'CV data must be an object.'], 422);
        }

        $statement = $pdo->prepare(
            'INSERT INTO cvs (id, user_id, title, cv_data) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title = VALUES(title), cv_data = VALUES(cv_data)'
        );
        $statement->execute([$userId, $userId, $title ?: 'My CV', json_encode($cvData, JSON_THROW_ON_ERROR)]);
        respond(['saved' => true, 'id' => $userId, 'user_id' => $userId]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
        $deleteId = $sessionUserId;
        $statement = $pdo->prepare('DELETE FROM cvs WHERE user_id = ? OR id = ?');
        $statement->execute([$deleteId, $deleteId]);
        respond(['cleared' => true, 'id' => $deleteId]);
    }

    respond(['error' => 'Method not allowed.'], 405);
} catch (JsonException $exception) {
    respond(['error' => 'Invalid JSON payload.'], 422);
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    respond(['error' => 'Database connection or query failed.'], 500);
}
