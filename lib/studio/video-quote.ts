/** Debounce input changes and cancel stale quotes without touching uploaded assets. */
export function scheduleVideoQuote<T>({load,onSuccess,onError,delay=150}:{load:(signal:AbortSignal)=>Promise<T>;onSuccess:(value:T)=>void;onError:(error:unknown)=>void;delay?:number}){
  const controller=new AbortController();
  const timer=setTimeout(()=>{
    void load(controller.signal).then(value=>{if(!controller.signal.aborted)onSuccess(value);},error=>{if(!controller.signal.aborted)onError(error);});
  },delay);
  return()=>{clearTimeout(timer);controller.abort();};
}
