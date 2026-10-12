<?php
declare(strict_types=1);

const DB_HOST = '127.0.0.1';
const DB_PORT = 3306;
const DB_NAME = 'cv_generator';
const DB_USER = 'root';
const DB_PASSWORD = 'root';
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_USERNAME = '';
const SMTP_PASSWORD = '';
const SMTP_FROM_EMAIL = '';
const SMTP_FROM_NAME = 'Northstar CV';

function ensureDatabaseSchema(PDO $pdo): void
{
    $tableExists = $pdo->query("SHOW TABLES LIKE 'cvs'")->fetchColumn();
    if (!$tableExists) {
        $schema = file_get_contents(__DIR__ . '/database.sql');
        if ($schema !== false) {
            foreach (array_filter(array_map('trim', preg_split('/;\s*\R/', $schema))) as $statement) {
                if ($statement !== '') {
                    $pdo->exec($statement . ';');
                }
            }
        }
        return;
    }

    $columnExists = $pdo->query("SHOW COLUMNS FROM cvs LIKE 'user_id'")->fetchColumn();
    if ($columnExists) {
        return;
    }

    $pdo->exec('ALTER TABLE cvs ADD COLUMN user_id CHAR(36) NULL AFTER id');
    $pdo->exec('UPDATE cvs SET user_id = id WHERE user_id IS NULL');
    $pdo->exec('DELETE FROM cvs WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)');
    $pdo->exec('ALTER TABLE cvs MODIFY user_id CHAR(36) NOT NULL');

    $indexExists = $pdo->query("SHOW INDEX FROM cvs WHERE Key_name = 'unique_user_id'")->fetchColumn(2);
    if (!$indexExists) {
        $pdo->exec('ALTER TABLE cvs ADD UNIQUE KEY unique_user_id (user_id)');
    }

    $foreignKeyExists = $pdo->query("SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cvs' AND CONSTRAINT_NAME = 'fk_cvs_user'")->fetchColumn();
    if (!$foreignKeyExists) {
        $pdo->exec('ALTER TABLE cvs ADD CONSTRAINT fk_cvs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE');
    }
}

function database(): PDO
{
    static $pdo;

    if (!$pdo) {
        $dsn = 'mysql:host=' . DB_HOST . ';port=' . DB_PORT . ';dbname=' . DB_NAME . ';charset=utf8mb4';

        $pdo = new PDO(
            $dsn,
            DB_USER,
            DB_PASSWORD,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );

        ensureDatabaseSchema($pdo);
    }

    return $pdo;
}
