export interface Query<Input, Output> {
  execute(input: Input): Promise<Output>;
}
