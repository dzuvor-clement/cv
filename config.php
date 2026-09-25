<?php
declare(strict_types=1);

const DB_HOST = '127.0.0.1';
const DB_NAME = 'cv_generator';
const DB_USER = 'root';
const DB_PASSWORD = 'root';
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 587;
const SMTP_USERNAME = '';
const SMTP_PASSWORD = '';
const SMTP_FROM_EMAIL = '';
const SMTP_FROM_NAME = 'Northstar CV';

function database(): PDO
{
    static $pdo;

    if (!$pdo) {
        $pdo = new PDO(
            'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
            DB_USER,
            DB_PASSWORD,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    }

    return $pdo;
}
