import { MikroORM } from '@mikro-orm/postgresql';
import mikroOrmConfig from '../../mikro-orm.config';
import { WalletEntity } from '../persistence/entities/wallet.entity';

async function seed() {
    const orm = await MikroORM.init(mikroOrmConfig);
    const em = orm.em.fork();

    const testPlayerId = '11111111-1111-1111-1111-111111111111';
    const testWalletId = '22222222-2222-2222-2222-222222222222';

    const existingWallet = await em.findOne(WalletEntity, { id: testWalletId });

    if (!existingWallet) {
        const wallet = em.create(WalletEntity, {
            id: testWalletId,
            playerId: testPlayerId,
            currency: 'BRL',
            balanceAmount: '500.00',
            version: 1,
        });

        await em.persist(wallet).flush();
        console.log('✅ Carteira de teste criada com sucesso! Saldo inicial: R$ 500,00');
    } else {
        console.log('ℹ️ Carteira de teste já existe.');
    }

    await orm.close();
}

seed();