FROM ubuntu:latest
LABEL authors="zryan"

ENTRYPOINT ["top", "-b"]