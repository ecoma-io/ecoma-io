export interface Command<Input, Output = void> {
  execute(input: Input): Promise<Output>;
}
