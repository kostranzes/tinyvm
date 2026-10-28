import json
import os
import subprocess
import sys


def start_session(path, timeout_ms=None):
    environment = os.environ.copy()

    if timeout_ms is not None:
        environment["TINYVM_IDLE_TIMEOUT_MS"] = str(timeout_ms)

    return subprocess.Popen(
        [path],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=environment,
    )


def send(process, command):
    process.stdin.write(json.dumps(command) + "\n")
    process.stdin.flush()
    return read_response(process)


def send_raw(process, text):
    process.stdin.write(text + "\n")
    process.stdin.flush()
    return read_response(process)


def read_response(process):
    line = process.stdout.readline()

    if not line:
        stderr = ""
        if process.poll() is not None and process.stderr is not None:
            stderr = process.stderr.read()

        raise AssertionError(
            "Session terminated without a JSON response. "
            f"Exit code: {process.poll()}. Stderr: {stderr}"
        )

    response = json.loads(line)

    required = {
        "status",
        "instruction_count",
        "registers",
        "error",
    }

    assert required.issubset(response.keys()), response
    assert isinstance(response["status"], str), response
    assert isinstance(response["instruction_count"], int), response

    return response


def expect_success(response):
    assert response["error"] is None, response
    assert isinstance(response["registers"], dict), response


def stop_session(process):
    if process.poll() is None:
        process.kill()

    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def close_session(process):
    response = send(process, {"command": "close"})
    expect_success(response)

    process.stdin.close()
    assert process.wait(timeout=5) == 0


def test_disassembly(process):
    response = send(process, {"command": "disassemble"})
    expect_success(response)

    assert "disassembly" in response, response

    disassembly = response["disassembly"]

    assert isinstance(disassembly, dict), response
    assert isinstance(disassembly["code_address"], str), disassembly
    assert isinstance(disassembly["code_end"], str), disassembly
    assert isinstance(disassembly["rip"], str), disassembly
    assert isinstance(disassembly["current_found"], bool), disassembly
    assert isinstance(disassembly["complete"], bool), disassembly

    instructions = disassembly["instructions"]

    assert isinstance(instructions, list), disassembly
    assert instructions, disassembly

    for instruction in instructions:
        assert isinstance(instruction["address"], str), instruction
        assert isinstance(instruction["size"], int), instruction
        assert instruction["size"] > 0, instruction
        assert isinstance(instruction["bytes"], str), instruction
        assert len(instruction["bytes"]) == instruction["size"] * 2
        assert isinstance(instruction["mnemonic"], str), instruction
        assert instruction["mnemonic"], instruction
        assert isinstance(instruction["operands"], str), instruction
        assert isinstance(instruction["is_current"], bool), instruction

    assert disassembly["current_found"] is True, disassembly

    current = [
        instruction
        for instruction in instructions
        if instruction["is_current"]
    ]

    assert len(current) == 1, disassembly
    assert current[0]["address"] == disassembly["rip"], disassembly

    response = send(
        process,
        {
            "command": "disassemble",
            "max_instructions": 0,
        },
    )
    assert response["error"] == "invalid_disassembly_arguments", response

    response = send(
        process,
        {
            "command": "disassemble",
            "max_instructions": 4097,
        },
    )
    assert response["error"] == "invalid_disassembly_arguments", response

    response = send(
        process,
        {
            "command": "disassemble",
            "max_instructions": "10",
        },
    )
    assert response["error"] == "invalid_disassembly_arguments", response

    print("[PASS] Capstone disassembly")
    print("[PASS] Current instruction identified by RIP")
    print("[PASS] Disassembly limit validation")


def test_array_session(session_path, code):
    numbers = [10, 20, 30, 40, 50]
    data = b"".join(number.to_bytes(8, "little") for number in numbers)

    process = start_session(session_path)

    try:
        response = send(process, {"command": "state"})
        expect_success(response)
        assert response["status"] == "ready"

        response = send(process, {"command": "unknown"})
        assert response["error"] == "unknown_command", response

        response = send_raw(process, '{"command":"state"} trailing')
        assert response["error"] == "invalid_json", response

        response = send_raw(process, '{"command":')
        assert response["error"] == "invalid_json", response

        response = send(
            process,
            {
                "command": "load",
                "code": code.hex(),
            },
        )
        expect_success(response)

        test_disassembly(process)

        response = send(
            process,
            {
                "command": "load",
                "code": code.hex(),
            },
        )
        assert response["error"] == "load_failed", response

        response = send(
            process,
            {
                "command": "initialize_memory",
                "address": "0x110000",
                "data": data.hex(),
            },
        )
        expect_success(response)

        response = send(
            process,
            {
                "command": "set_register",
                "register": "rdi",
                "value": "0x110000",
            },
        )
        expect_success(response)

        response = send(
            process,
            {
                "command": "set_register",
                "register": "rsi",
                "value": "5",
            },
        )
        expect_success(response)

        response = send(
            process,
            {
                "command": "set_register",
                "register": "rip",
                "value": "0",
            },
        )
        assert response["error"] == "register_write_failed", response

        response = send(
            process,
            {
                "command": "set_register",
                "register": "rax",
                "value": "18446744073709551616",
            },
        )
        assert response["error"] == "invalid_register_arguments", response

        response = send(
            process,
            {
                "command": "read_memory",
                "address": "0x110000",
                "size": "40",
            },
        )
        expect_success(response)
        assert response["data"] == data.hex(), response

        response = send(process, {"command": "step"})
        expect_success(response)
        assert response["status"] == "running", response
        assert response["instruction_count"] == 1, response

        response = send(process, {"command": "state"})
        expect_success(response)
        assert response["instruction_count"] == 1, response

        response = send(process, {"command": "disassemble"})
        expect_success(response)

        disassembly = response["disassembly"]
        current = [
            instruction
            for instruction in disassembly["instructions"]
            if instruction["is_current"]
        ]

        assert disassembly["current_found"] is True, disassembly
        assert len(current) == 1, disassembly
        assert current[0]["address"] == response["registers"]["rip"], response

        response = send(
            process,
            {
                "command": "initialize_memory",
                "address": "0x110000",
                "data": data.hex(),
            },
        )
        assert response["error"] == "memory_initialization_failed", response

        response = send(process, {"command": "run"})
        expect_success(response)
        assert response["status"] == "finished", response
        assert int(response["registers"]["rax"], 16) == 150, response
        assert response["instruction_count"] > 1, response

        response = send(process, {"command": "run"})
        expect_success(response)
        assert response["status"] == "finished", response

        response = send(process, {"command": "step"})
        assert response["error"] == "session_finished", response

        response = send(
            process,
            {
                "command": "read_memory",
                "address": "0x110000",
                "size": "40",
            },
        )
        expect_success(response)
        assert response["data"] == data.hex(), response

        close_session(process)

        print("[PASS] Persistent JSON session")
        print("[PASS] NASM array execution")
        print("[PASS] Register and memory initialization")
        print("[PASS] Step and continue")
        print("[PASS] State and memory inspection")
        print("[PASS] Strict JSON validation")
        print("[PASS] Terminal state handling")

    finally:
        stop_session(process)


def test_final_step(session_path):
    process = start_session(session_path)

    try:
        response = send(
            process,
            {
                "command": "load",
                "code": "90",
            },
        )
        expect_success(response)

        response = send(process, {"command": "step"})
        expect_success(response)

        assert response["status"] == "finished", response
        assert response["instruction_count"] == 1, response

        close_session(process)

        print("[PASS] Final step is successful")

    finally:
        stop_session(process)


def test_oversized_request(session_path):
    process = start_session(session_path)

    try:
        response = send_raw(process, "x" * 270000)
        assert response["error"] == "request_too_large", response

        response = send(process, {"command": "state"})
        expect_success(response)
        assert response["status"] == "ready", response

        close_session(process)

        print("[PASS] Oversized request recovery")

    finally:
        stop_session(process)


def test_idle_timeout(session_path):
    process = start_session(session_path, timeout_ms=1000)

    try:
        response = read_response(process)

        assert response["error"] == "session_timeout", response
        assert process.wait(timeout=5) == 0

        print("[PASS] Session idle timeout")

    finally:
        stop_session(process)


def main():
    if len(sys.argv) != 3:
        print("Usage: test_session.py <session-executable> <array-binary>")
        return 1

    session_path = sys.argv[1]
    binary_path = sys.argv[2]

    with open(binary_path, "rb") as file:
        code = file.read()

    test_array_session(session_path, code)
    test_final_step(session_path)
    test_oversized_request(session_path)
    test_idle_timeout(session_path)

    print("\nAll session integration tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
