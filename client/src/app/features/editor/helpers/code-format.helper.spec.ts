import { CodeFormatError, findFormatErrors, formatCode } from './code-format.helper';

describe('formatCode errors', () => {
   it('reports the line and column of a syntax error', async () => {
      const err = await formatCode('const a = 1;\nconst b = ;\n', 'typescript', 80).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CodeFormatError);
      const e = err as CodeFormatError;
      expect(e.line).toBe(2);
      expect(e.column).toBeGreaterThan(0);
      // The location is kept out of the reason (it is shown separately).
      expect(e.reason).not.toMatch(/\(\d+:\d+\)/);
   });

   it('locates a mistake inside a snippet of bare methods', async () => {
      const err = await formatCode('foo() {\n  return 1;\n}\nbar() {\n  return (;\n}', 'typescript', 80).catch(
         (e: unknown) => e
      );
      expect(err).toBeInstanceOf(CodeFormatError);
      expect((err as CodeFormatError).line).toBe(5);
   });

   it('still formats valid code', async () => {
      await expect(formatCode('const a=1', 'typescript', 80)).resolves.toBe('const a = 1;');
   });
});

describe('findFormatErrors', () => {
   it('finds every failing line, not just the first', async () => {
      const errs = await findFormatErrors('const a = ;\nconst b = 1;\nconst c = ;\n', 'typescript', 80);
      expect(errs.map((e) => e.line)).toEqual([1, 3]);
   });

   it('is empty for valid code', async () => {
      await expect(findFormatErrors('const a=1', 'typescript', 80)).resolves.toEqual([]);
   });
});

describe('breakLongImports', () => {
   it('breaks a single-name import that is wider than the print width', async () => {
      const out = await formatCode(
         "import { VeryLongServiceName } from '../../services/very-long-service-name.service';",
         'typescript',
         40
      );
      expect(out).toBe("import {\n  VeryLongServiceName,\n} from '../../services/very-long-service-name.service';");
   });
});
