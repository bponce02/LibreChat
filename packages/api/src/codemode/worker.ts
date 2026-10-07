export const codemodeWorker: string = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { getQuickJS } = require(workerData.engine);
(async () => {
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(workerData.policy.memoryBytes);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + workerData.policy.timeoutMs;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const vm = runtime.newContext();
  const pending = new Map();
  let nextId = 0;
  let finished = false;
  const output = [];
  const images = [];
  let outputBytes = 0;
  let result;
  const fail = code => {
    if (finished) return;
    finished = true;
    parentPort.postMessage({ type: 'done', result: { ok: false, output, error: code } });
  };
  function emit(value) {
    const line = typeof value === 'string' ? value : JSON.stringify(value);
    if (line === undefined) return;
    outputBytes += Buffer.byteLength(line);
    if (outputBytes > workerData.policy.maxOutputBytes) { fail('LIMIT'); throw new Error('Output limit'); }
    output.push(line);
  }
  function pump() {
    if (finished) return;
    const jobs = runtime.executePendingJobs();
    if (jobs.error) { jobs.error.dispose(); fail(Date.now() >= deadline ? 'TIMEOUT' : 'SCRIPT_ERROR'); return; }
    const state = vm.getPromiseState(result);
    if (state.type === 'pending') return;
    if (state.type === 'rejected') { state.error.dispose(); fail(Date.now() >= deadline ? 'TIMEOUT' : 'SCRIPT_ERROR'); return; }
    try { emit(vm.dump(state.value)); } catch { state.value.dispose(); fail('LIMIT'); return; }
    state.value.dispose();
    finished = true;
    parentPort.postMessage({ type: 'done', result: { ok: true, output, ...(images.length && { images }) } });
  }
  const bridge = vm.newFunction('__call', (name, args) => {
    const toolName = vm.dump(name);
    const input = vm.dump(args);
    const encoded = JSON.stringify(input);
    if (typeof toolName !== 'string' || encoded === undefined || Buffer.byteLength(encoded) > workerData.policy.maxValueBytes) throw new Error('Invalid tool input');
    const deferred = vm.newPromise();
    const id = ++nextId;
    pending.set(id, deferred);
    parentPort.postMessage({ type: 'call', id, name: toolName, input: JSON.parse(encoded) });
    return deferred.handle;
  });
  const print = vm.newFunction('__text', value => { emit(vm.dump(value)); return vm.undefined; });
  const picture = vm.newFunction('__image', value => {
    const ref = vm.dump(value);
    if (typeof ref !== 'string' || !/^image-[a-f0-9]{64}$/.test(ref) || images.length >= workerData.policy.maxImages) throw new Error('Invalid image reference');
    images.push(ref);
    return vm.undefined;
  });
  vm.setProp(vm.global, '__image', picture);
  picture.dispose();
  vm.setProp(vm.global, '__call', bridge);
  vm.setProp(vm.global, '__text', print);
  bridge.dispose();
  print.dispose();
  const bootstrap = vm.evalCode(
    'const __descriptors = ' + JSON.stringify(workerData.tools) + ';' +
    'const tools = Object.freeze(Object.fromEntries(__descriptors.map(d => [d.name, args => __call(d.name, args)])));' +
    'const text = value => __text(value);' +
    'const image = ref => __image(ref);' +
    'const searchTools = query => __descriptors.filter(d => (d.name + " " + d.description).toLowerCase().includes(String(query).toLowerCase())).map(d => ({name:d.name,description:d.description}));' +
    'const describeTool = name => __descriptors.find(d => d.name === name) ?? null;'
  );
  if (bootstrap.error) { bootstrap.error.dispose(); fail('UNAVAILABLE'); return; }
  bootstrap.value.dispose();
  const evaluated = vm.evalCode('(async () => {\n' + workerData.code + '\n})()');
  if (evaluated.error) { evaluated.error.dispose(); fail(Date.now() >= deadline ? 'TIMEOUT' : 'SCRIPT_ERROR'); return; }
  result = evaluated.value;
  parentPort.on('message', message => {
    if (finished) return;
    const deferred = pending.get(message.id);
    if (!deferred) return;
    pending.delete(message.id);
    const value = message.ok ? vm.newString(JSON.stringify(message.value ?? null)) : vm.newError('Tool invocation failed');
    if (message.ok) {
      const parsed = vm.evalCode('JSON.parse(' + JSON.stringify(vm.dump(value)) + ')');
      value.dispose();
      if (parsed.error) { deferred.reject(parsed.error); parsed.error.dispose(); }
      else { deferred.resolve(parsed.value); parsed.value.dispose(); }
    } else { deferred.reject(value); value.dispose(); }
    deferred.dispose();
    pump();
  });
  pump();
})().catch(() => parentPort.postMessage({ type: 'done', result: { ok: false, output: [], error: 'UNAVAILABLE' } }));
`;
