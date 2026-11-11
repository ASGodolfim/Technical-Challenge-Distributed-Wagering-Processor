import 'reflect-metadata';
import * as ts from 'typescript';
import * as fs from 'fs';

(globalThis as any).Bun.plugin({
    name: 'tsc-decorator-metadata',
    setup(build: any) {
        build.onLoad({ filter: /\.ts$/ }, async (args: { path: string }) => {
            if (args.path.includes('node_modules')) return undefined;
            const source = await fs.promises.readFile(args.path, 'utf8');
            const result = ts.transpileModule(source, {
                fileName: args.path,
                compilerOptions: {
                    module: ts.ModuleKind.ESNext,
                    target: ts.ScriptTarget.ES2022,
                    experimentalDecorators: true,
                    emitDecoratorMetadata: true,
                    esModuleInterop: true,
                    skipLibCheck: true,
                },
            });
            return {
                contents: result.outputText,
                loader: 'js',
            };
        });
    },
});