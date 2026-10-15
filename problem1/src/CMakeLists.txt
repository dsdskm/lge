add_library(sut STATIC store.c ctl.c)
target_include_directories(sut PUBLIC ${CMAKE_SOURCE_DIR}/include)
target_link_libraries(sut PRIVATE coverage)
