import json
import subprocess
import sys
import tempfile
from pathlib import Path


def run_command(command):
    return subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )


def parse_json_result(result):
    assert result.stdout.endswith("\n"), result.stdout

    lines = result.stdout.splitlines()
    assert len(lines) == 1, result.stdout

    data = json.loads(lines[0])

    assert isinstance(data, dict), data
    assert set(data) == {
        "status",
        "error",
        "instruction_count",
        "registers",
    }, data

    assert isinstance(data["status"], str), data
    assert data["status"] in {
        "finished",
        "limit_exceeded",
        "error",
    }, data

    assert data["error"] is None or isinstance(data["error"], str), data
    assert isinstance(data["instruction_count"], int), data
    assert data["instruction_count"] >= 0, data

    if data["registers"] is not None:
        assert isinstance(data["registers"], dict), data
        assert "rax" in data["registers"], data
        assert "rip" in data["registers"], data

        for value in data["registers"].values():
            assert isinstance(value, str), data
            assert value.startswith("0x"), data

    return data


def check_success(engine_path, nasm_path, sample_path):
    with tempfile.TemporaryDirectory() as temp_dir:
        binary_path = Path(temp_dir) / "sample.bin"

        assembly = run_command([
            nasm_path,
            "-f",
            "bin",
            str(sample_path),
            "-o",
            str(binary_path),
        ])

        assert assembly.returncode == 0, assembly.stderr

        result = run_command([engine_path, str(binary_path)])

        assert result.returncode == 0, result.stderr
        assert result.stderr == "", result.stderr

        data = parse_json_result(result)

        assert data["status"] == "finished", data
        assert data["error"] is None, data
        assert data["instruction_count"] == 4, data
        assert data["registers"]["rax"] == "0x0000000000000060", data


def check_missing_file(engine_path):
    result = run_command([
        engine_path,
        "/path/that/does/not/exist.bin",
    ])

    assert result.returncode != 0
    assert "Cannot open binary file" in result.stderr

    data = parse_json_result(result)

    assert data["status"] == "error", data
    assert data["error"] == "binary_load_failed", data
    assert data["instruction_count"] == 0, data
    assert data["registers"] is None, data


def check_invalid_arguments(engine_path):
    result = run_command([engine_path])

    assert result.returncode != 0
    assert "Usage:" in result.stderr

    data = parse_json_result(result)

    assert data["status"] == "error", data
    assert data["error"] == "invalid_arguments", data
    assert data["instruction_count"] == 0, data
    assert data["registers"] is None, data


def main():
    if len(sys.argv) != 4:
        raise SystemExit(
            "Usage: test_cli.py <engine> <nasm> <sample.asm>"
        )

    engine_path, nasm_path, sample_path = sys.argv[1:]

    check_success(engine_path, nasm_path, sample_path)
    print("[PASS] CLI successful execution")

    check_missing_file(engine_path)
    print("[PASS] CLI missing binary")

    check_invalid_arguments(engine_path)
    print("[PASS] CLI invalid arguments")


if __name__ == "__main__":
    main()