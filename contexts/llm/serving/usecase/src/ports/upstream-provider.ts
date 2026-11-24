/**
 * Port dispatch upstream — MỘT attempt POST body với Authorization Bearer.
 * Implement thật là fetch; classification KHÔNG thuộc port.
 *
 * Bất biến platform: credential plaintext CHỈ đi vào header Authorization của
 * fetch này — không log, không persist, không response.
 */

/** Loại failure mạng của một attempt dispatch. */
export type UpstreamFailureKind = 'timeout' | 'network';

/** Kết quả exec raw của một lần dispatch — chưa phân loại. */
export interface RawUpstreamOutcome {
  readonly failureKind: UpstreamFailureKind | null;
  readonly httpStatus: number | null;
  readonly bodyText: string | null;
  readonly retryAfterHeader: string | null;
}

export interface UpstreamProvider {
  dispatch(input: {
    url: string;
    /** Plaintext credential — opaque passthrough, KHÔNG BAO GIỜ log/store. */
    credentialPlaintext: string;
    payloadText: string;
  }): Promise<RawUpstreamOutcome>;
}
