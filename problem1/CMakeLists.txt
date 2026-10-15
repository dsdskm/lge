cmake_minimum_required(VERSION 3.16)
project(telemetry_store_ctl C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

add_compile_definitions(HOST_UNITTEST)
option(ENABLE_COVERAGE "Instrument the SUT for coverage" ON)

add_library(coverage INTERFACE)
if(ENABLE_COVERAGE)
    target_compile_options(coverage INTERFACE --coverage -O0 -g)
    target_link_options(coverage INTERFACE --coverage)
endif()

add_subdirectory(external/unity)
add_subdirectory(external/fff)
add_subdirectory(src)

enable_testing()
add_subdirectory(solution)
