// Portability shim for building the MSVC-oriented engine-sim sources with clang/emscripten.
#pragma once
#ifndef _MSC_VER
#define __forceinline inline __attribute__((always_inline))
#endif
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <algorithm>
