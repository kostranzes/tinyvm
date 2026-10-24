cmake_minimum_required(VERSION 3.20)

project(TinyVMEngine
    VERSION 0.1.0
    LANGUAGES C
)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(UNICORN REQUIRED IMPORTED_TARGET unicorn)
pkg_check_modules(CAPSTONE REQUIRED IMPORTED_TARGET capstone)

add_executable(tinyvm-engine
    src/main.c
)

target_link_libraries(tinyvm-engine PRIVATE
    PkgConfig::UNICORN
    PkgConfig::CAPSTONE
)

target_compile_options(tinyvm-engine PRIVATE
    -Wall
    -Wextra
    -Wpedantic
)
