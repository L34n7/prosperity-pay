import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source=readFileSync(new URL("../src/lib/accounting/money-input.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(source,{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const module={exports:{}};
vm.runInNewContext(compiled,{module,exports:module.exports,Intl,Number,RegExp});
const {formatMoneyInput,moneyInputFromCents,moneyInputToCents}=module.exports;

test("digitação como calculadora converte dígitos em centavos com máscara brasileira",()=>{
 assert.equal(formatMoneyInput("1"),"0,01");
 assert.equal(formatMoneyInput("12"),"0,12");
 assert.equal(formatMoneyInput("123"),"1,23");
 assert.equal(formatMoneyInput("1234"),"12,34");
 assert.equal(formatMoneyInput("121809"),"1.218,09");
 assert.equal(formatMoneyInput("1.218,09"),"1.218,09");
 assert.equal(formatMoneyInput(""),"");
});
test("ao editar valores do banco mantém os centavos sem arredondamento de float",()=>{
 assert.equal(moneyInputFromCents(121809),"1.218,09");
 assert.equal(moneyInputFromCents(1),"0,01");
 assert.equal(moneyInputFromCents(100),"1,00");
 assert.equal(moneyInputToCents("1.218,09"),121809);
 assert.equal(moneyInputToCents("0,01"),1);
 assert.equal(moneyInputToCents(""),0);
 assert.equal(moneyInputToCents("1.000.000,00"),100000000);
 assert.equal(moneyInputToCents("abc"),0);
});
test("não aceita números acima do limite e não confunde separador decimal",()=>{
 assert.equal(formatMoneyInput("999999999999999"),"9.999.999.999,99");
 assert.equal(moneyInputToCents("9999999999999"),0);
 assert.equal(moneyInputToCents("1218.09"),121809);
});
