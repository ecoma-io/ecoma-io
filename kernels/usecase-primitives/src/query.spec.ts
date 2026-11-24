import type { Query } from './query';

interface GetAccountInput {
  accountId: string;
}

interface GetAccountOutput {
  id: string;
  email: string;
  status: 'active' | 'suspended';
}

type GetAccountQuery = Query<GetAccountInput, GetAccountOutput>;

type Execute = GetAccountQuery['execute'];

// Execute nhận đúng input contract đã khai báo.
describe('query execute input', () => {
  // Thuần kiểu: expectTypeOf không tạo assertion runtime.
  it('accepts the declared input contract', () => {
    expectTypeOf<Parameters<Execute>>().toEqualTypeOf<[input: GetAccountInput]>();
  });

  // Execute trả về Promise của output contract.
  it('returns a Promise of the declared output contract', () => {
    expectTypeOf<ReturnType<Execute>>().toEqualTypeOf<Promise<GetAccountOutput>>();
    expectTypeOf<Awaited<ReturnType<Execute>>>().toEqualTypeOf<GetAccountOutput>();
  });
});
