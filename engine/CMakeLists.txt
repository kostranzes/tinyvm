
cmake_minimum_required(VERSION 3.20)

project(tinyvm LANGUAGES C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

find_package(PkgConfig REQUIRED)

pkg_check_modules(UNICORN REQUIRED IMPORTED_TARGET unicorn)
pkg_check_modules(CAPSTONE REQUIRED IMPORTED_TARGET capstone)

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
    -Wall -Wextra -Wpedantic
)

add_executable(tinyvm-engine src/main.c)

target_link_libraries(tinyvm-engine PRIVATE tinyvm-core)

target_compile_options(tinyvm-engine PRIVATE
    -Wall -Wextra -Wpedantic
)

include(CTest)

if(BUILD_TESTING)
    add_executable(tinyvm-tests tests/test_vm.c)

    target_link_libraries(tinyvm-tests PRIVATE tinyvm-core)

    target_compile_options(tinyvm-tests PRIVATE
        -Wall -Wextra -Wpedantic
    )

    add_test(NAME vm-tests COMMAND tinyvm-tests)
endif()
