import React from 'react';

export class OptionalFeatureBoundary extends React.Component<{ children: React.ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="modal-backdrop"><section className="modal-card" role="alertdialog" aria-modal="true" aria-label="Feature unavailable"><h2>This feature hasn’t loaded</h2><p>Reconnect to the internet and reload when your call is finished. Your Phone Book is still available.</p><button className="btn btn-primary" onClick={this.props.onClose}>Close</button></section></div>;
  }
}
