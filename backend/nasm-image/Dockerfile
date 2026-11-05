FROM debian:stable-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends nasm \
    && rm -rf /var/lib/apt/lists/*

COPY assemble.sh /usr/local/bin/assemble.sh
RUN chmod 755 /usr/local/bin/assemble.sh

# Непривилегированный пользователь (nobody).
USER 65534:65534
WORKDIR /work

ENTRYPOINT ["/usr/local/bin/assemble.sh"]