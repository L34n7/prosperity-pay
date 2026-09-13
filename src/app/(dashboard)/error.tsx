"use client";
export default function Error({reset}:{error:Error;reset:()=>void}) {return <section className="panel operational-panel" role="alert"><h1>Não foi possível carregar esta página.</h1><p>Verifique sua conexão e tente novamente.</p><button className="primary-button" onClick={reset}>Tentar novamente</button></section>}
