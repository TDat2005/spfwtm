import "dotenv/config";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../../generated/prisma/client.ts";

function requireEnvironment(name: string): string {
    const value = process.env[name];

    if (!value) {
        throw new Error(`Thiếu biến môi trường: ${name}`);
    }

    return value;
}

export function createPrismaClient(): PrismaClient {
    const databasePort = Number(
        requireEnvironment("DATABASE_PORT"),
    );

    if (!Number.isInteger(databasePort)) {
        throw new Error("DATABASE_PORT phải là số nguyên");
    }

    const adapter = new PrismaMariaDb({
        host: requireEnvironment("DATABASE_HOST"),
        port: databasePort,
        user: requireEnvironment("DATABASE_USER"),
        password: requireEnvironment("DATABASE_PASSWORD"),
        database: requireEnvironment("DATABASE_NAME"),
        connectionLimit: 5,
        allowPublicKeyRetrieval: process.env.NODE_ENV !== "production",
    });

    return new PrismaClient({
        adapter,
    });
}
