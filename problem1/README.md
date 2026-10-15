# 임베디드 C 단위 테스트 과제

## 개요

이 패키지는 **호스트 기반(host-based) 단위 테스트** 과제입니다. 타깃 보드 없이
개발 PC에서 빌드·실행하며, 제공된 C 모듈(`src/`)에 대한 단위 테스트를 `solution/`
디렉터리에 작성합니다.

- 테스트는 `solution/` 에만 작성합니다.
- `src/`, `include/`, `external/` 의 내용은 수정하지 마십시오. (수정하더라도
  평가에는 제공된 원본이 사용됩니다.)

대상은 파일 기반 로그를 메모리로 적재(load)·저장(save)하고 가공하는 `store` 와,
이를 구동하는 제어 상태 머신 `ctl` 입니다.

## 환경

- Ubuntu 24.04, CMake ≥ 3.16, Ninja, GCC
- 단위 테스트 프레임워크 **Unity** 와 페이크 프레임워크 **FFF** 가 `external/` 에
  포함되어 있습니다.
- 커버리지 측정에는 `gcovr` 를 사용합니다.

## 빌드 & 테스트

```sh
cmake -S . -B build -G Ninja
cmake --build build
ctest --test-dir build --output-on-failure
```

## 커버리지 확인 (자기 점검용)

```sh
cmake -S . -B build -G Ninja -DENABLE_COVERAGE=ON
cmake --build build
ctest --test-dir build
gcovr --root . --filter 'src/' --txt-metric branch --print-summary
```

## 디렉터리 구조

```
.
├── CMakeLists.txt        구성 (외부 라이브러리/SUT/테스트 연결)
├── include/              모듈 인터페이스 헤더
├── src/                  테스트 대상 구현 (수정 금지)
├── external/             Unity · FFF
└── solution/             ← 여기에 테스트를 작성합니다
    ├── CMakeLists.txt     테스트 타깃 정의 (필요에 맞게 수정 가능)
    └── sample_test.c      빌드 확인용 최소 예시
```

`solution/sample_test.c` 는 빌드가 통과하는지 확인하기 위한 최소 예시입니다. 자유롭게
교체하거나 파일을 추가하십시오. 테스트 타깃 추가나 링크 옵션이 필요하면
`solution/CMakeLists.txt` 도 수정할 수 있습니다.

## 제출

작업 폴더 전체가 채점 서버로 전달되지만, 채점에는 **`solution/` 디렉터리만**
사용됩니다. 작성한 테스트 코드와 `solution/CMakeLists.txt` 가 모두 `solution/`
아래에 있는지 확인하세요. `solution/` 밖(`src/`, `include/` 등)의 수정은 채점에
반영되지 않습니다.

제출 전 `ctest` 를 실행해 **모든 테스트가 통과하는지 확인하세요.** 실패하는 테스트는 감점됩니다.

## 기준점 (git)

이 디렉터리는 git 저장소로 초기화되어 있으며, 제공된 상태가 첫 커밋으로 기록되어
있습니다. 작업 중 언제든 `git status` / `git diff` / `git checkout` 으로 제공 상태와
비교하거나 복원할 수 있습니다.

## 주의 사항
본 프로젝트에서는 `Unity` 테스트 프레임워크와 `FFF` Mock 라이브러리를 제공합니다. 테스트 코드를 작성할 때 해당 라이브러리들을 적절히 활용하십시오.
시험 점수에는 직접 반영되지 않지만, 테스트 프레임워크와 Mock 프레임워크를 효과적으로 사용하면 테스트 코드를 더 간결하고 읽기 쉽게 작성할 수 있습니다.
따라서 제공된 라이브러리의 사용법을 이해하고, 이를 활용하여 명확하고 깔끔한 테스트 코드를 작성하는 것이 좋습니다.
