FROM python:3.12-slim
WORKDIR /app
COPY . .
# Datos y copias de seguridad en un volumen persistente (no se pierden en redeploys)
ENV FIDELIA_DB=/data/fidelia.db
ENV FIDELIA_HOST=0.0.0.0
ENV FIDELIA_PORT=8000
VOLUME ["/data"]
EXPOSE 8000
CMD ["python", "fidelia.py"]
