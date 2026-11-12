# ExecuTorch Wasm + WebGPU loader

`executorch_wasm_lib.js` is the loader for the ExecuTorch Wasm runtime with
its WebGPU backend. It is copied unmodified from
`website/playground/webgpu/runtime/` in
[pytorch/executorch](https://github.com/pytorch/executorch) at commit
`4d292c973384ffdc3e63089df901f5f8b8bca4ad` (ExecuTorch 1.6.0 sources), under
the BSD licence in `LICENSE`.

The matching `.wasm` is not stored here. The Harness game
downloads it from Hugging Face at a pinned revision and checks its SHA-256;
see `src/components/widgets/harness/executorch.js`.
