import json
import os
import subprocess
import sys
import time


def start_session(path, timeout_ms=None, extra_environment=None):
    environment = os.environ.copy()

    if timeout_ms is not None:
        environment["TINYVM_IDLE_TIMEOUT_MS"] = str(timeout_ms)

    if extra_environment:
        environment.update(extra_environment)

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


def test_strict_numbers(session_path):
    process = start_session(session_path)

    try:
        response = send(process, {"command": "load", "code": "90"})
        expect_success(response)

        valid = {"10": 10, "010": 10, "08": 8, "0x10": 16, "0XfF": 255}

        for text, expected in valid.items():
            response = send(
                process,
                {"command": "set_register", "register": "rax", "value": text},
            )
            expect_success(response)

            response = send(process, {"command": "state"})
            assert int(response["registers"]["rax"], 16) == expected, (
                text,
                response,
            )

        invalid = [
            "",
            "0x",
            "-1",
            "+1",
            " 5",
            "5 ",
            "\n5",
            "\r5",
            "1_0",
            "0xg",
            "1e3",
            "18446744073709551616",
            "0x10000000000000000",
        ]

        for text in invalid:
            response = send(
                process,
                {"command": "set_register", "register": "rax", "value": text},
            )
            assert response["error"] == "invalid_register_arguments", (
                text,
                response,
            )

        response = send(
            process,
            {"command": "set_register", "register": "rax", "value": 5},
        )
        assert response["error"] == "invalid_register_arguments", response

        response = send(
            process,
            {
                "command": "set_register",
                "register": "rax",
                "value": "18446744073709551615",
            },
        )
        expect_success(response)

        response = send(process, {"command": "state"})
        assert response["registers"]["rax"] == "0xffffffffffffffff", response

        close_session(process)

        print("[PASS] Strict numeric parsing")

    finally:
        stop_session(process)


def test_nul_byte(session_path):
    process = start_session(session_path)

    try:
        response = send_raw(process, '{"command":"state"}\x00garbage')
        assert response["error"] == "invalid_json", response

        response = send_raw(process, '\x00{"command":"state"}')
        assert response["error"] == "invalid_json", response

        response = send(process, {"command": "state"})
        expect_success(response)
        assert response["status"] == "ready", response

        close_session(process)

        print("[PASS] NUL byte rejection")

    finally:
        stop_session(process)


def test_program_not_loaded(session_path):
    process = start_session(session_path)

    try:
        for command in ("step", "run", "disassemble"):
            response = send(process, {"command": command})
            assert response["error"] == "program_not_loaded", response
            assert response["status"] == "ready", response
            assert response["instruction_count"] == 0, response

        response = send(process, {"command": "load", "code": "90"})
        expect_success(response)

        response = send(process, {"command": "step"})
        expect_success(response)
        assert response["status"] == "finished", response

        close_session(process)

        print("[PASS] Commands before load do not break the session")

    finally:
        stop_session(process)


def test_instruction_limit(session_path):
    process = start_session(session_path)

    try:
        response = send(process, {"command": "load", "code": "ebfe"})
        expect_success(response)

        invalid = ["0", "1000001", "abc", "", "-5", 10, None]

        for value in invalid:
            response = send(
                process,
                {"command": "set_instruction_limit", "limit": value},
            )
            assert response["error"] == "invalid_limit_arguments", (
                value,
                response,
            )

        response = send(process, {"command": "set_instruction_limit"})
        assert response["error"] == "invalid_limit_arguments", response

        response = send(
            process,
            {"command": "set_instruction_limit", "limit": "10"},
        )
        expect_success(response)
        assert response["instruction_limit"] == 10, response

        response = send(process, {"command": "run"})
        assert response["error"] == "instruction_limit_exceeded", response
        assert response["status"] == "limit_exceeded", response
        assert response["instruction_count"] == 10, response

        response = send(
            process,
            {"command": "set_instruction_limit", "limit": "20"},
        )
        assert response["error"] == "limit_change_failed", response

        close_session(process)

    finally:
        stop_session(process)

    process = start_session(session_path)

    try:
        response = send(process, {"command": "load", "code": "ebfe"})
        expect_success(response)

        response = send(process, {"command": "run"})
        assert response["error"] == "instruction_limit_exceeded", response
        assert response["instruction_count"] == 1000, response

        close_session(process)

    finally:
        stop_session(process)

    process = start_session(session_path)

    try:
        response = send(process, {"command": "load", "code": "9090"})
        expect_success(response)

        response = send(
            process,
            {"command": "set_instruction_limit", "limit": "1000000"},
        )
        expect_success(response)
        assert response["instruction_limit"] == 1000000, response

        response = send(process, {"command": "step"})
        expect_success(response)

        response = send(
            process,
            {"command": "set_instruction_limit", "limit": "5"},
        )
        assert response["error"] == "limit_change_failed", response

        close_session(process)

        print("[PASS] Instruction limit command")

    finally:
        stop_session(process)


def test_large_memory_initialization(session_path):
    process = start_session(session_path)

    try:
        data = bytes(index % 251 for index in range(65536))

        response = send(process, {"command": "load", "code": "90"})
        expect_success(response)

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
                "command": "read_memory",
                "address": "0x110000",
                "size": "4096",
            },
        )
        expect_success(response)
        assert response["data"] == data[:4096].hex(), response

        response = send(
            process,
            {
                "command": "read_memory",
                "address": hex(0x110000 + 65536 - 16),
                "size": "16",
            },
        )
        expect_success(response)
        assert response["data"] == data[-16:].hex(), response

        close_session(process)

        print("[PASS] Maximum memory initialization request")

    finally:
        stop_session(process)


def test_slow_request_timeout(session_path):
    process = start_session(session_path, timeout_ms=1000)

    try:
        started = time.monotonic()

        try:
            process.stdin.write('{"command":')
            process.stdin.flush()

            for _ in range(10):
                time.sleep(0.3)
                process.stdin.write(" ")
                process.stdin.flush()
        except BrokenPipeError:
            pass

        response = read_response(process)
        elapsed = time.monotonic() - started

        assert response["error"] == "session_timeout", response
        assert elapsed < 2.5, elapsed
        assert process.wait(timeout=5) == 0

        print("[PASS] Slow request cannot extend the idle timeout")

    finally:
        stop_session(process)


def read_proc_limit(pid, name):
    with open(f"/proc/{pid}/limits") as file:
        for line in file:
            if line.startswith(name):
                fields = line[len(name):].split()
                return fields[0], fields[1]

    raise AssertionError(f"limit not found: {name}")


def read_no_new_privs(pid):
    with open(f"/proc/{pid}/status") as file:
        for line in file:
            if line.startswith("NoNewPrivs:"):
                return line.split()[1]

    return None


def test_process_restrictions(session_path):
    if not os.path.exists("/proc/self/limits"):
        print("[SKIP] Process restrictions (no /proc)")
        return

    process = start_session(session_path)

    try:
        # A response proves that startup (and the restrictions) completed.
        expect_success(send(process, {"command": "state"}))

        pid = process.pid

        assert read_proc_limit(pid, "Max cpu time") == ("120", "120")
        assert read_proc_limit(pid, "Max core file size") == ("0", "0")
        assert read_proc_limit(pid, "Max open files") == ("64", "64")
        assert read_proc_limit(pid, "Max address space")[0] == "unlimited"
        assert read_no_new_privs(pid) in ("1", None)

        close_session(process)

    finally:
        stop_session(process)

    process = start_session(
        session_path,
        extra_environment={"TINYVM_CPU_LIMIT_S": "30"},
    )

    try:
        expect_success(send(process, {"command": "state"}))
        assert read_proc_limit(process.pid, "Max cpu time") == ("30", "30")
        close_session(process)

    finally:
        stop_session(process)

    if os.environ.get("TINYVM_SKIP_MEMORY_LIMIT_TEST") != "1":
        process = start_session(
            session_path,
            extra_environment={"TINYVM_MEMORY_LIMIT_MB": "8192"},
        )

        try:
            expect_success(send(process, {"command": "state"}))

            expected = str(8192 * 1024 * 1024)

            assert read_proc_limit(process.pid, "Max address space") == (
                expected,
                expected,
            )

            # The VM must still work under the address-space limit.
            expect_success(send(process, {"command": "load", "code": "90"}))

            response = send(process, {"command": "run"})
            expect_success(response)
            assert response["status"] == "finished", response

            close_session(process)

        finally:
            stop_session(process)

    for name, value in (
        ("TINYVM_CPU_LIMIT_S", "abc"),
        ("TINYVM_CPU_LIMIT_S", "0"),
        ("TINYVM_MEMORY_LIMIT_MB", "1"),
    ):
        process = start_session(
            session_path,
            extra_environment={name: value},
        )

        try:
            stdout, stderr = process.communicate(timeout=5)

            assert process.returncode == 1, (name, value, stderr)
            assert stdout == "", (name, value, stdout)
            assert name in stderr, (name, value, stderr)

        finally:
            stop_session(process)

    print("[PASS] Process restrictions")


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
    test_process_restrictions(session_path)
    test_strict_numbers(session_path)
    test_nul_byte(session_path)
    test_program_not_loaded(session_path)
    test_instruction_limit(session_path)
    test_large_memory_initialization(session_path)
    test_oversized_request(session_path)
    test_idle_timeout(session_path)
    test_slow_request_timeout(session_path)

    print("\nAll session integration tests passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
