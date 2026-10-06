export type CheckoutResult = {razorpay_order_id:string;razorpay_payment_id:string;razorpay_signature:string};
export type CheckoutInstance = {open:()=>void;close:()=>void;on:(event:string,handler:()=>void)=>void};
export type CheckoutOptions = {key:string;order_id:string;amount:number;currency:string;name:string;description:string;handler:(response:CheckoutResult)=>void;modal:{ondismiss:()=>void}};
declare global {interface Window {Razorpay?:new(options:CheckoutOptions)=>CheckoutInstance;}}
let loading:Promise<void>|null=null;
export function loadCheckout():Promise<void> {
 if(window.Razorpay)return Promise.resolve();
 if(loading)return loading;
 loading=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://checkout.razorpay.com/v1/checkout.js';script.async=true;
  const timer=setTimeout(()=>fail(),15000);
  const fail=()=>{clearTimeout(timer);script.remove();reject(new Error('Razorpay checkout could not load. Check your connection or content blocker and retry.'));};
  script.onload=()=>{clearTimeout(timer);if(window.Razorpay)resolve();else fail();};script.onerror=fail;document.body.appendChild(script);
 }).catch(e=>{loading=null;throw e;});
 return loading;
}
