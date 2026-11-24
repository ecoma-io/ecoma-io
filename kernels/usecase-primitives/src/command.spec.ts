import type { Command } from './command';

interface RegisterAccountInput {
  email: string;
}

interface RegisterAccountOutput {
  accountId: string;
}

type RegisterAccountCommand = Command<RegisterAccountInput, RegisterAccountOutput>;

type Execute = RegisterAccountCommand['execute'];

// Execute nhận đúng input contract đã khai báo.
describe('command execute input', () => {
  // Thuần kiểu: expectTypeOf không tạo assertion runtime.
  it('accepts the declared input contract', () => {
    expectTypeOf<Parameters<Execute>>().toEqualTypeOf<[input: RegisterAccountInput]>();
  });

  // Execute trả về Promise của output contract.
  it('returns a Promise of the declared output contract', () => {
    expectTypeOf<ReturnType<Execute>>().toEqualTypeOf<Promise<RegisterAccountOutput>>();
    expectTypeOf<Awaited<ReturnType<Execute>>>().toEqualTypeOf<RegisterAccountOutput>();
  });

  // Output mặc định là void khi không khai báo.
  it('defaults output to void', () => {
    expectTypeOf<Command<RegisterAccountInput>['execute']>().toEqualTypeOf<
      (input: RegisterAccountInput) => Promise<void>
    >();
  });
});
