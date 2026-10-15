add_executable(sample_test sample_test.c)
target_link_libraries(sample_test PRIVATE sut unity fff coverage)
add_test(NAME sample_test COMMAND sample_test)
