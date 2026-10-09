import { FormEvent, useEffect, useState } from 'react';
import { getTasks, createTask } from '../api';
import { Task } from '../types';

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await getTasks();
      setTasks(data.tasks);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    try {
      const result = await createTask({ title, description, priority: 'medium' });
      setTasks((prev) => [result.task, ...prev]);
      setTitle('');
      setDescription('');
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-content">
      <header className="page-title">
        <div>
          <h1>Task Center</h1>
          <p>Track and create tasks for TerminalTron-T001’s mission flow.</p>
        </div>
      </header>

      <section className="form-card">
        <h2>New task</h2>
        <form onSubmit={handleSubmit} className="task-form">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter task title" />
          </label>
          <label>
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Task details" />
          </label>
          <button type="submit" disabled={loading} className="primary-button">
            {loading ? 'Saving...' : 'Create task'}
          </button>
        </form>
      </section>

      <section className="table-card">
        <h2>Active tasks</h2>
        {loading && tasks.length === 0 ? (
          <p>Loading tasks...</p>
        ) : (
          <div className="task-list">
            {tasks.map((task) => (
              <article key={task.id} className="task-item">
                <div>
                  <h3>{task.title}</h3>
                  <p>{task.description || 'No description provided.'}</p>
                </div>
                <span className="task-badge">{task.priority}</span>
              </article>
            ))}
            {tasks.length === 0 && <p>No tasks yet. Create one to get started.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
