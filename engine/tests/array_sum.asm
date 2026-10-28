bits 64

    xor rax, rax
    xor rcx, rcx

    test rsi, rsi
    jz done

loop_start:
    add rax, [rdi + rcx * 8]
    inc rcx
    cmp rcx, rsi
    jb loop_start

done:
