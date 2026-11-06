FROM debian:stable-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential cmake pkg-config \
        libunicorn-dev libcapstone-dev libjson-c-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY CMakeLists.txt ./
COPY include include
COPY src src

# Без BUILD_TESTING не нужны Python и NASM. Тип сборки не задаём,
# чтобы бинарник собирался так же, как при локальных тестах.
RUN cmake -S . -B build -DBUILD_TESTING=OFF \
    && cmake --build build --target tinyvm-session

FROM debian:stable-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libunicorn2 libcapstone5 libjson-c5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /src/build/tinyvm-session /usr/local/bin/tinyvm-session

USER 65534:65534
ENTRYPOINT ["/usr/local/bin/tinyvm-session"]