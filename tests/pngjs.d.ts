declare module 'pngjs' {
  export class PNG {
    static readonly sync: {
      read(data: Buffer): PNG;
    };

    readonly width: number;
    readonly height: number;
    readonly data: Buffer;
  }
}
