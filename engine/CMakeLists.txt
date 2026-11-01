cmake_minimum_required(VERSION 3.20)

project(tinyvm LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

find_package(PkgConfig REQUIRED)

pkg_check_modules(UNICORN REQUIRED IMPORTED_TARGET unicorn)
pkg_check_modules(CAPSTONE REQUIRED IMPORTED_TARGET capstone)
pkg_check_modules(JSON_C REQUIRED IMPORTED_TARGET json-c)

add_library(tinyvm-core STATIC
    src/vm.c
    src/disasm.c
)

target_include_directories(tinyvm-core PUBLIC include)

target_link_libraries(tinyvm-core PUBLIC
    PkgConfig::UNICORN
    PkgConfig::CAPSTONE
)

target_compile_options(tinyvm-core PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

add_executable(tinyvm-engine
    src/main.c
)

target_link_libraries(tinyvm-engine PRIVATE tinyvm-core)

target_compile_options(tinyvm-engine PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

add_library(tinyvm-protocol STATIC
    src/protocol_json.c
)

target_include_directories(tinyvm-protocol PUBLIC include)

target_link_libraries(tinyvm-protocol PUBLIC
    tinyvm-core
    PkgConfig::JSON_C
)

target_compile_options(tinyvm-protocol PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

add_executable(tinyvm-session
    src/session.c
)

target_link_libraries(tinyvm-session PRIVATE tinyvm-protocol)

target_compile_options(tinyvm-session PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)

include(CTest)

if(BUILD_TESTING)
    find_package(Python3 REQUIRED COMPONENTS Interpreter)
    find_program(NASM_EXECUTABLE nasm REQUIRED)

    add_executable(tinyvm-tests
        tests/test_vm.c
    )

    target_link_libraries(tinyvm-tests PRIVATE tinyvm-core)

    target_compile_options(tinyvm-tests PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    add_test(
        NAME vm-tests
        COMMAND tinyvm-tests
    )

    add_test(
        NAME cli-tests
        COMMAND
            ${Python3_EXECUTABLE}
            ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_cli.py
            $<TARGET_FILE:tinyvm-engine>
            ${NASM_EXECUTABLE}
            ${CMAKE_CURRENT_SOURCE_DIR}/tests/sample.asm
    )

    set(ARRAY_SUM_BINARY
        ${CMAKE_CURRENT_BINARY_DIR}/array_sum.bin
    )

    add_custom_command(
        OUTPUT ${ARRAY_SUM_BINARY}
        COMMAND
            ${NASM_EXECUTABLE}
            -f bin
            ${CMAKE_CURRENT_SOURCE_DIR}/tests/array_sum.asm
            -o ${ARRAY_SUM_BINARY}
        DEPENDS
            ${CMAKE_CURRENT_SOURCE_DIR}/tests/array_sum.asm
        COMMENT "Assembling array_sum.asm"
        VERBATIM
    )

    add_custom_target(tinyvm-array-sample
        DEPENDS ${ARRAY_SUM_BINARY}
    )

    add_executable(tinyvm-input-tests
        tests/test_inputs.c
    )

    target_link_libraries(tinyvm-input-tests PRIVATE tinyvm-core)

    target_compile_options(tinyvm-input-tests PRIVATE
        -Wall
        -Wextra
        -Wpedantic
    )

    add_dependencies(tinyvm-input-tests tinyvm-array-sample)

    add_test(
        NAME input-tests
        COMMAND tinyvm-input-tests ${ARRAY_SUM_BINARY}
    )

    add_test(
        NAME session-tests
        COMMAND
            ${Python3_EXECUTABLE}
            ${CMAKE_CURRENT_SOURCE_DIR}/tests/test_session.py
            $<TARGET_FILE:tinyvm-session>
            ${ARRAY_SUM_BINARY}
    )
endif()
