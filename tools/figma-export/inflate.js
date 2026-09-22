/* Minimal raw-DEFLATE inflate, small enough to inline in a plugin script.
   The sandbox has figma.base64Decode and Uint8Array but no DecompressionStream
   and no TextDecoder, so the payload is ASCII-escaped before compression and
   reassembled with fromCharCode. */
const INFLATE = [
'function INF(d){var p=0,b=0,n=0,out=[];',
'function bits(c){while(n<c){b|=d[p++]<<n;n+=8;}var v=b&((1<<c)-1);b>>>=c;n-=c;return v;}',
'function build(L){var C=[],S=[],i,M=15;for(i=0;i<=M;i++)C[i]=0;for(i=0;i<L.length;i++)C[L[i]]++;C[0]=0;',
'var O=[0,0];for(i=1;i<=M;i++)O[i]=O[i-1]+C[i-1];for(i=0;i<L.length;i++)if(L[i])S[O[L[i]]++]=i;return{C:C,S:S};}',
'function dec(h){var code=0,first=0,index=0,len,count;for(len=1;len<=15;len++){code|=bits(1);count=h.C[len];',
'if(code-first<count)return h.S[index+(code-first)];index+=count;first=(first+count)<<1;code<<=1;}throw new Error("bad code");}',
'var LB=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258],',
'LE=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],',
'DB=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577],',
'DE=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],last,i,k;',
'do{last=bits(1);var type=bits(2);',
'if(type===0){b=0;n=0;var len=d[p]|(d[p+1]<<8);p+=4;for(i=0;i<len;i++)out.push(d[p++]);}',
'else{var lit,dist;',
'if(type===1){var l=[];for(i=0;i<144;i++)l[i]=8;for(i=144;i<256;i++)l[i]=9;for(i=256;i<280;i++)l[i]=7;for(i=280;i<288;i++)l[i]=8;',
'lit=build(l);var dd=[];for(i=0;i<30;i++)dd[i]=5;dist=build(dd);}',
'else{var hlit=bits(5)+257,hdist=bits(5)+1,hclen=bits(4)+4,',
'ord=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],cl=[];',
'for(i=0;i<19;i++)cl[i]=0;for(i=0;i<hclen;i++)cl[ord[i]]=bits(3);',
'var clh=build(cl),L=[];',
'while(L.length<hlit+hdist){var s=dec(clh);',
'if(s<16)L.push(s);',
'else if(s===16){var prev=L[L.length-1],r=3+bits(2);while(r--)L.push(prev);}',
'else if(s===17){var r2=3+bits(3);while(r2--)L.push(0);}',
'else{var r3=11+bits(7);while(r3--)L.push(0);}}',
'lit=build(L.slice(0,hlit));dist=build(L.slice(hlit));}',
'for(;;){var s2=dec(lit);',
'if(s2<256)out.push(s2);',
'else if(s2===256)break;',
'else{var ii=s2-257,ln=LB[ii]+bits(LE[ii]),ds=dec(dist),off=DB[ds]+bits(DE[ds]),st=out.length-off;',
'for(k=0;k<ln;k++)out.push(out[st+k]);}}}}while(!last);',
'var str="";for(i=0;i<out.length;i+=4096)str+=String.fromCharCode.apply(null,out.slice(i,i+4096));',
'return str;}',
'function UNPACK(b64){return JSON.parse(INF(figma.base64Decode(b64)));}',
].join('\n');

module.exports = { INFLATE };
