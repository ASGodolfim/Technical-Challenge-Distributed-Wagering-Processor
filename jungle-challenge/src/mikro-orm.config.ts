import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

export default defineConfig({
    host: 'localhost',
    port: 5432,
    user: 'jungle_user',
    password: 'jungle_password',
    dbName: 'jungle_db',
    entities: ['./dist/**/*.entity.js'],
    entitiesTs: ['./src/**/*.entity.ts'],
    extensions: [Migrator],
    migrations: {
        path: './src/infrastructure/database/migrations',
        pathTs: './src/infrastructure/database/migrations',
    },
    debug: true,
});