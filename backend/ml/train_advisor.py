"""LoRA del agente asesor (memo + updates) sobre un modelo de la flota. Corre en la máquina con GPU.

No hace falta entrenar para usar el asesor: el prompt + la verificación de cifras y refs ya corren con qwen-30b.
Entrena solo cuando tengas ejemplos revisados en la app (Aprobar / Guardar mi edición / Rechazar):

    node scripts/advisor-trainset.mjs          # en el Mac → backend/ml/data/advisor_{sft,dpo,test}.jsonl
    pip install "transformers>=4.51" "peft>=0.13" "trl>=0.12" datasets accelerate
    python train_advisor.py sft --base <id del modelo base> --out out/advisor-lora            # ≥ 200 ejemplos
    python train_advisor.py dpo --base <id> --adapter out/advisor-lora --out out/advisor-lora-dpo   # ≥ 100 pares

Servir (docs de vLLM, "Serving LoRA Adapters"):

    vllm serve <id base> --port 8001 --enable-lora --max-lora-rank 16 --lora-modules advisor-lora=/ruta/out/advisor-lora

y en research/.env: ADVISOR_ROLE=small y ADVISOR_MODEL=advisor-lora. Antes, compara:
    node --env-file-if-exists=.env scripts/advisor-eval.mjs --a chat --b advisor-lora
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

DATA = Path(__file__).parent / "data"


def load(path: Path, minimum: int, what: str) -> list[dict]:
    rows = [json.loads(l) for l in path.read_text().splitlines() if l.strip()] if path.exists() else []
    if len(rows) < minimum:
        raise SystemExit(f"Solo {len(rows)} {what} en {path}; hacen falta ≥ {minimum}. Sigue revisando en la app: el prompt ya funciona sin entrenar.")
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["sft", "dpo"])
    ap.add_argument("--base", required=True, help="id del modelo base (el mismo que sirve el puerto)")
    ap.add_argument("--adapter", type=Path, help="adaptador SFT de partida (para dpo)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--beta", type=float, default=0.1)
    ap.add_argument("--max-len", type=int, default=6144)
    args = ap.parse_args()

    from datasets import Dataset
    from peft import LoraConfig
    target = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
    peft_cfg = LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, task_type="CAUSAL_LM", target_modules=target)

    if args.mode == "sft":
        from trl import SFTConfig, SFTTrainer
        rows = [{"messages": r["messages"]} for r in load(DATA / "advisor_sft.jsonl", 200, "ejemplos SFT")]
        cfg = SFTConfig(output_dir=str(args.out), num_train_epochs=args.epochs, learning_rate=args.lr,
                        per_device_train_batch_size=1, gradient_accumulation_steps=8, bf16=True, logging_steps=10,
                        save_strategy="epoch", max_length=args.max_len, assistant_only_loss=True, report_to=[])
        trainer = SFTTrainer(model=args.base, train_dataset=Dataset.from_list(rows), args=cfg, peft_config=peft_cfg)
    else:
        from peft import PeftModel
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from trl import DPOConfig, DPOTrainer
        rows = [{"prompt": r["prompt"], "chosen": r["chosen"], "rejected": r["rejected"]} for r in load(DATA / "advisor_dpo.jsonl", 100, "pares DPO")]
        tok = AutoTokenizer.from_pretrained(args.base)
        model = AutoModelForCausalLM.from_pretrained(args.base, torch_dtype="auto")
        if args.adapter:
            model = PeftModel.from_pretrained(model, str(args.adapter), is_trainable=True)
            peft_cfg = None
        cfg = DPOConfig(output_dir=str(args.out), num_train_epochs=1, learning_rate=args.lr / 2, beta=args.beta,
                        per_device_train_batch_size=1, gradient_accumulation_steps=8, bf16=True, logging_steps=10,
                        max_length=args.max_len, report_to=[])
        trainer = DPOTrainer(model=model, args=cfg, train_dataset=Dataset.from_list(rows), processing_class=tok, peft_config=peft_cfg)
    trainer.train()
    trainer.save_model(str(args.out))
    print(f"Adaptador guardado en {args.out}")


if __name__ == "__main__":
    main()
