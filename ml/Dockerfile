FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY src /app
EXPOSE 9000
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "9000"]
