#include <unity.h>
#include <fff.h>
#include "ctl.h"
#include "store.h"

DEFINE_FFF_GLOBALS;

/* Minimal FFF example on an unrelated function (illustration only). */
FAKE_VALUE_FUNC(int, sample_dep, int);

void setUp(void)
{
    RESET_FAKE(sample_dep);
    FFF_RESET_HISTORY();
    store_reset_stats();
}

void tearDown(void) { }

void test_build_smoke(void)
{
    ctl_t c;
    TEST_ASSERT_EQUAL_INT(SC_EINVAL, ctl_init(&c, NULL));
}

void test_fff_smoke(void)
{
    sample_dep_fake.return_val = 42;
    TEST_ASSERT_EQUAL_INT(42, sample_dep(7));
    TEST_ASSERT_EQUAL_UINT(1, sample_dep_fake.call_count);
    TEST_ASSERT_EQUAL_INT(7, sample_dep_fake.arg0_val);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_build_smoke);
    RUN_TEST(test_fff_smoke);
    return UNITY_END();
}
