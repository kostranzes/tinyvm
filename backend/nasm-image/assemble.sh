#!/bin/sh
set -eu

# Исходник приходит в stdin, байты уходят в stdout, ошибки NASM в stderr.
cat > /work/in.asm
nasm -f bin -o /work/out.bin /work/in.asm
cat /work/out.bin