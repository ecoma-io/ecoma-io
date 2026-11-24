import { asGrantId, asSubject, mockGrantStore } from '../testing/mock-ports.js';
import { ConnectedApplicationsListQuery } from './connected-applications-list.js';
import { ConnectedApplicationsRevokeUseCase } from './connected-applications-revoke.js';

const subject = asSubject('sub-1');

describe('ConnectedApplicationsListQuery', () => {
  it('lists connected applications for the subject', async () => {
    expect.hasAssertions();
    const query = new ConnectedApplicationsListQuery(
        mockGrantStore({
          listConnectedApplications: async () => [
            {
              clientId: 'client-1' as never,
              grantId: asGrantId('g-1'),
              grantedAt: new Date(0),
              scopes: ['profile'],
            },
          ],
        }),
      ),
      output = await query.execute({ subject });

    expect(output.applications).toHaveLength(1);
    expect(output.applications[0]?.grantId).toBe('g-1');
  });

  it('rejects subject longer than 200 characters', async () => {
    expect.hasAssertions();
    const query = new ConnectedApplicationsListQuery(mockGrantStore());

    await expect(query.execute({ subject: asSubject('s'.repeat(201)) })).rejects.toThrow(
      'subject qua dai',
    );
  });
});

describe('ConnectedApplicationsRevokeUseCase', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';

  it('revokes grant atomically with client revocation', async () => {
    expect.hasAssertions();
    let revokeCalled = 0;
    const grants = mockGrantStore({
        revokeGrantWithClientRevocation: async () => {
          revokeCalled += 1;
          return 'won' as const;
        },
      }),
      useCase = new ConnectedApplicationsRevokeUseCase(grants),
      output = await useCase.execute({
        clientId: 'client-1' as never,
        grantId: asGrantId(validUuid),
        subject,
      });

    expect(output).toStrictEqual({ revoked: true });
    expect(revokeCalled).toBe(1);
  });

  it('returns 404 invalid_grant on CAS loss (non-oracle)', async () => {
    expect.hasAssertions();
    const grants = mockGrantStore({
        revokeGrantWithClientRevocation: async () => 'lost' as const,
      }),
      useCase = new ConnectedApplicationsRevokeUseCase(grants);

    await expect(
      useCase.execute({ clientId: 'client-1' as never, grantId: asGrantId(validUuid), subject }),
    ).rejects.toMatchObject({ code: 'invalid_grant', httpStatus: 404 });
  });

  it('rejects malformed grant id pre-DB', async () => {
    expect.hasAssertions();
    const useCase = new ConnectedApplicationsRevokeUseCase(mockGrantStore());

    await expect(
      useCase.execute({ clientId: 'client-1' as never, grantId: asGrantId('not-a-uuid'), subject }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
