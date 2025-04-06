import { workerProxy } from './workerProxy.ts';
workerProxy.startThreading();
workerProxy.proxyFunctions();
async function main() {
  console.log('start');
  console.log(await workerProxy.api.sleep(1000));
  console.log('end');
}
main();
