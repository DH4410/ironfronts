declare module 'wgsl_reflect/wgsl_reflect.module.js' {
  interface EntryPointInfo { name: string }

  export class WgslReflect {
    constructor(source: string);
    entry: {
      vertex: EntryPointInfo[];
      fragment: EntryPointInfo[];
      compute: EntryPointInfo[];
    };
    getBindGroups(): unknown[][];
  }
}
