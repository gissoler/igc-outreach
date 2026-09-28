"""LoRA de extracción de deals sobre qwen-4b (Módulo 1, paso 5).

Corre en la máquina con GPU de la flota (no en el Mac). Entrada: backend/ml/data/train.jsonl, generado con
`node scripts/deals.mjs trainset` (formato chat: system, user, assistant con solo campos verificados).

    pip install "transformers>=4.51" "peft>=0.13" "trl>=0.12" datasets accelerate
    python train_lora.py --base Qwen/Qwen3-4B-Instruct-2507 --data data/train.jsonl --out out/deals-lora

Servirlo en vLLM junto al modelo base (docs de vLLM, "Serving LoRA Adapters"):

    vllm serve Qwen/Qwen3-4B-Instruct-2507 --port 8001 --enable-lora --lora-modules deals-lora=/ruta/out/deals-lora

y probarlo con VLLM_EXTRACT_ROLE=deals-lora (`node scripts/deals.mjs compare --a chat --b deals-lora`).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_rows(path: Path) -> list[dict]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if len(rows) < 100:
        raise SystemExit(f"Solo {len(rows)} páginas en {path}. El Módulo 1 pide 500–2.000 extracciones verificadas antes de entrenar.")
    return [{"messages": r["messages"]} for r in rows]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="id del modelo base (el mismo que sirve el puerto 8001)")
    ap.add_argument("--data", type=Path, default=Path(__file__).parent / "data" / "train.jsonl")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out" / "deals-lora")
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--max-len", type=int, default=8192)
    args = ap.parse_args()

    from datasets import Dataset
    from peft import LoraConfig
    from trl import SFTConfig, SFTTrainer

    ds = Dataset.from_list(load_rows(args.data))
    peft_cfg = LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, task_type="CAUSAL_LM",
                          target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"])
    cfg = SFTConfig(output_dir=str(args.out), num_train_epochs=args.epochs, learning_rate=args.lr,
                    per_device_train_batch_size=1, gradient_accumulation_steps=8, bf16=True, logging_steps=10,
                    save_strategy="epoch", max_length=args.max_len, assistant_only_loss=True, report_to=[])
    trainer = SFTTrainer(model=args.base, train_dataset=ds, args=cfg, peft_config=peft_cfg)
    trainer.train()
    trainer.save_model(str(args.out))
    print(f"Adaptador guardado en {args.out}")


if __name__ == "__main__":
    main()
